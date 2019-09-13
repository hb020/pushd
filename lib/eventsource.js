const policyFile = '<?xml version="1.0"?>' +
             '<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">' +
             '<cross-domain-policy>' +
             '<site-control permitted-cross-domain-policies="master-only"/>' +
             '<allow-access-from domain="*" secure="false"/>' +
             '<allow-http-request-headers-from domain="*" headers="Accept"/>' +
             '</cross-domain-policy>';

exports.setup = function(app, authorize, eventPublisher) {
    // In order to support access from flash apps
    app.get('/crossdomain.xml', function(req, res) {
        res.set('Content-Type', 'application/xml');
        return res.send(policyFile);
    });

    app.options('/subscribe', authorize('listen'), function(req, res) {
        res.set({
            'Content-Type': 'text/event-stream',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
            'Access-Control-Max-Age': '86400'
        });
        return res.end();
    });

    return app.get('/subscribe', authorize('listen'), function(req, res) {
        if (!req.accepts('text/event-stream')) {
            res.send(406);
            return;
        }

        if (typeof req.query.events !== 'string') {
            res.send(400);
            return;
        }

        const eventNames = req.query.events.split(' ');

		// Node.js 0.12 requires timeout argument be finite
        req.socket.setTimeout(0x7FFFFFFF);
        req.socket.setNoDelay(true);
        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'Connection': 'close'
        });
        res.write('\n');

        if (__guard__(req.get('User-Agent'), x => x.indexOf('MSIE')) !== -1) {
            // Work around MSIE bug preventing Progress handler from behing thrown before first 2048 bytes
            // See http://forums.adobe.com/message/478731
            res.write(new Array(2048).join('\n'));
        }

        const sendEvent = function(event, payload) {
            const data = {
                event: event.name,
                title: payload.title,
                message: payload.msg,
                data: payload.data
            };

            return res.write("data: " + JSON.stringify(data) + "\n\n");
        };

        const antiIdleInterval = setInterval(() => res.write("\n")
        , 10000);

        res.socket.on('close', () => {
            clearInterval(antiIdleInterval);
            return Array.from(eventNames).map((eventName) =>
                eventPublisher.removeListener(eventName, sendEvent));
        });

        return (() => {
            const result = [];
            for (let eventName of Array.from(eventNames)) {
                result.push(eventPublisher.addListener(eventName, sendEvent));
            }
            return result;
        })();
    });
};

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
