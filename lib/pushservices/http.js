const http = require('http');
const url = require('url');

class PushServiceHTTP {
    validateToken(token) {
        const info = url.parse(token);
        if (['http:', 'https:'].includes(info != null ? info.protocol : undefined)) {
            return token;
        }
    }

    constructor(conf, logger, tokenResolver) {
        this.conf = conf;
        this.logger = logger;
    }

    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            const options = url.parse(info.token);
            options.method = 'POST';
            options.headers = {
              'Content-Type': 'application/json',
              'Connection': 'close'
          };

            const body = {
                event: payload.event.name,
                title: payload.title,
                message: payload.msg,
                data: payload.data
            };

            const req = http.request(options);

            req.on('error', e => {});
                // TODO: allow some error before removing
                //@logger?.warn("HTTP Automatic unregistration for subscriber #{subscriber.id}")
                //subscriber.delete()

            req.write(JSON.stringify(body));
            return req.end();
        });
    }
}

exports.PushServiceHTTP = PushServiceHTTP;
