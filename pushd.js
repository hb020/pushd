let redis;
const express = require('express');
const basicAuth = require('basic-auth-connect');
const bodyParser = require('body-parser');
const dgram = require('dgram');
const zlib = require('zlib');
const url = require('url');
const { Netmask } = require('netmask');
const settings = require('./settings');
const { Subscriber } = require('./lib/subscriber');
const { EventPublisher } = require('./lib/eventpublisher');
const { Event } = require('./lib/event');
const { PushServices } = require('./lib/pushservices');
const { Payload } = require('./lib/payload');
const logger = require('winston');
const morgan = require('morgan');

if (settings.server.redis_socket != null) {
    redis = require('redis').createClient(settings.server.redis_socket);
} else if ((settings.server.redis_port != null) || (settings.server.redis_host != null)) {
    redis = require('redis').createClient(settings.server.redis_port, settings.server.redis_host);
} else {
    redis = require('redis').createClient();
}
if (settings.server.redis_db_number != null) {
    redis.select(settings.server.redis_db_number);
}

if (settings.logging != null) {
    logger.remove(logger.transports.Console);
    for (let loggerconfig of Array.from(settings.logging)) {
        const transport = logger.transports[loggerconfig['transport']];
        if (transport != null) {
            logger.add(transport, loggerconfig.options || {});
        } else {
            process.stderr.write(`Invalid logger transport: ${loggerconfig['transport']}\n`);
        }
    }
}

if ((settings.server != null ? settings.server.redis_auth : undefined) != null) {
    redis.auth(settings.server.redis_auth);
}

const createSubscriber = function(fields, cb) {
    let service;
    logger.verbose(`creating subscriber proto = ${fields.proto}, token = ${fields.token}`);
    if (!(service = pushServices.getService(fields.proto))) { throw new Error("Invalid value for `proto'"); }
    if (!(fields.token = service.validateToken(fields.token))) { throw new Error("Invalid value for `token'"); }
    return Subscriber.prototype.create(redis, fields, cb);
};

const tokenResolver = (proto, token, cb) => Subscriber.prototype.getInstanceFromToken(redis, proto, token, cb);

var pushServices = new PushServices();
for (let name in settings) {
    const conf = settings[name];
    if (conf.enabled) {
        logger.info(`Registering push service: ${name}`);
        pushServices.addService(name, new conf.class(conf, logger, tokenResolver));
    }
}
const eventPublisher = new EventPublisher(pushServices);

const checkUserAndPassword = (username, password) => {
    if ((settings.server != null ? settings.server.auth : undefined) != null) {
        if ((settings.server.auth[username] == null)) {
            logger.error(`Unknown user ${username}`);
            return false;
        }
        const passwordOK = (password != null) && (password === settings.server.auth[username].password);
        if (!passwordOK) {
            logger.error(`Invalid password for ${username}`);
        }
        return passwordOK;
    }
    return false;
};

const app = express();

if (settings.server != null ? settings.server.access_log : undefined) { app.use(morgan(':method' + ' :url :status')); }
if (((settings.server != null ? settings.server.auth : undefined) != null) && ((settings.server != null ? settings.server.acl : undefined) == null)) {
    app.use(basicAuth(checkUserAndPassword));
}
app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.disable('x-powered-by');

app.param('subscriber_id', function(req, res, next, id) {
    try {
        req.subscriber = new Subscriber(redis, req.params.subscriber_id);
        delete req.params.subscriber_id;
        return next();
    } catch (error) {
        return res.status(400).json({error: error.message});
    }
});

const getEventFromId = id => new Event(redis, id);

const testSubscriber = subscriber => pushServices.push(subscriber, null, new Payload({msg: "Test", "data.test": "ok"}));

const checkStatus = () => redis.connected;

app.param('event_id', function(req, res, next, id) {
    try {
        req.event = getEventFromId(req.params.event_id);
        delete req.params.event_id;
        return next();
    } catch (error) {
        return res.status(400).json({error: error.message});
    }
});

const authorize = function(realm) {
    let allow_from;
    if ((settings.server != null ? settings.server.auth : undefined) != null) {
        return function(req, res, next) {
            // req.user has been set by express.basicAuth
            logger.verbose(`Authenticating ${req.user} for ${realm}`);
            if ((req.user == null)) {
                logger.error("User not authenticated");
                res.status(403).json({error: 'Unauthorized'});
                return;
            }

            const allowedRealms = (settings.server.auth[req.user] != null ? settings.server.auth[req.user].realms : undefined) || [];
            if (!Array.from(allowedRealms).includes(realm)) {
                logger.error(`No access to ${realm} for ${req.user}, allowed: ${allowedRealms}`);
                res.status(403).json({error: 'Unauthorized'});
                return;
            }

            return next();
        };
    } else if (allow_from = __guard__(settings.server != null ? settings.server.acl : undefined, x => x[realm])) {
        let network;
        const networks = [];
        for (network of Array.from(allow_from)) {
            networks.push(new Netmask(network));
        }
        return function(req, res, next) {
            let remoteAddr;
            if (remoteAddr = req.socket && (req.socket.remoteAddress || (req.socket.socket && req.socket.socket.remoteAddress))) {
                remoteAddr = remoteAddr.replace(/^.*:/, ''); // poor man's forcing it ipv4 in case
                //logger.silly(`Got connection from ${remoteAddr}`); 
            	for (network of Array.from(networks)) {
                    if (network.contains(remoteAddr)) {
                        next();
                        return;
                    }
                }
            }
            return res.status(403).json({error: 'Unauthorized'});
        };
    } else {
        return (req, res, next) => next();
    }
};

require('./lib/api').setupRestApi(app, createSubscriber, getEventFromId, authorize, testSubscriber, eventPublisher, checkStatus);

let port = __guard__(settings != null ? settings.server : undefined, x => x.tcp_port) != null ? __guard__(settings != null ? settings.server : undefined, x => x.tcp_port) : 80;
const listen_ip = __guard__(settings != null ? settings.server : undefined, x1 => x1.listen_ip);
if (listen_ip) {
    app.listen(port, listen_ip);
    logger.info(`Listening on ip address ${listen_ip} and tcp port ${port}`);
} else {
    app.listen(port);
    logger.info(`Listening on tcp port ${port}`);
}

// UDP Event API
const udpApi = dgram.createSocket("udp4");

const event_route = /^\/event\/([a-zA-Z0-9:._-]{1,100})$/;
udpApi.checkaccess = authorize('publish');
udpApi.on('message', function(msg, rinfo) {
    return zlib.unzip(msg, (err, msg) => {
        let method;
        if (err || !msg.toString()) {
            logger.error(`UDP Cannot decode message: ${err}`);
            return;
        }
        [method, msg] = Array.from(msg.toString().split(/\s+/, 2));
        if (!msg) { [msg, method] = Array.from([method, 'POST']); }
        const req = url.parse(msg != null ? msg : '', true);
        method = method.toUpperCase();
        // emulate an express route middleware call
        return this.checkaccess({socket: {remoteAddress: rinfo.address}}, {json() { return logger.info(`UDP/${method} ${req.pathname} 403`); }}, function() {
            let m;
            let status = 404;
            if (m = req.pathname != null ? req.pathname.match(event_route) : undefined) {
                try {
                    const event = new Event(redis, m[1]);
                    status = 204;
                    switch (method) {
                        case 'POST': eventPublisher.publish(event, req.query); break;
                        case 'DELETE': event.delete(); break;
                        default: status = 404;
                    }
                } catch (error) {
                    logger.error(error.stack);
                    return;
                }
            }
            if (settings.server != null ? settings.server.access_log : undefined) { return logger.info(`UDP/${method} ${req.pathname} ${status}`); }
        });
    });
});

port = __guard__(settings != null ? settings.server : undefined, x2 => x2.udp_port);
if (port != null) {
    udpApi.bind(port);
    logger.info(`Listening on udp port ${port}`);
}

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
