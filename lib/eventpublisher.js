const events = require('events');
const { Payload } = require('./payload');
const logger = require('winston');

class EventPublisher extends events.EventEmitter {
    constructor(pushServices) {
        super();
        this.pushServices = pushServices;
    }

    publish(event, data, cb) {
        let payload;
        try {
            payload = new Payload(data);
            payload.event = event;
        } catch (error) {
            // Invalid payload (empty, missing key or invalid key format)
            const e = error;
            logger.error('Invalid payload ' + e);
            if (cb) { cb(-1); }
            return;
        }

        this.emit(event.name, event, payload);

        return event.exists(exists => {
            if (!exists) {
                logger.verbose(`Tried to publish to a non-existing event ${event.name}`);
                if (cb) { cb(0); }
                return;
            }

            try {
                // Do not compile templates before to know there's some subscribers for the event
                // and do not start serving subscribers if payload won't compile
                payload.compile();
            } catch (e) {
                logger.error("Invalid payload, template doesn't compile");
                if (cb) { cb(-1); }
                return;
            }

            logger.verbose(`Pushing message for event ${event.name}`);
            logger.silly(`data = ${JSON.stringify(data)}`);
            logger.silly('Title: ' + payload.localizedTitle('en'));
            logger.silly('Message: ' + payload.localizedMessage('en'));

            const protoCounts = {};
            return event.forEachSubscribers((subscriber, subOptions, done) => {
                // action
                subscriber.get(info => {
                    if ((info != null ? info.proto : undefined) != null) {
                        if (protoCounts[info.proto] != null) {
                            return protoCounts[info.proto] += 1;
                        } else {
                            return protoCounts[info.proto] = 1;
                        }
                    }
                });

                return this.pushServices.push(subscriber, subOptions, payload, done);
            }
            , totalSubscribers => {
                // finished
                logger.verbose(`Pushed to ${totalSubscribers} subscribers`);
                for (let proto in protoCounts) {
                    const count = protoCounts[proto];
                    logger.verbose(`${count} ${proto} subscribers`);
                }

                if (totalSubscribers > 0) {
                    // update some event' stats
                    return event.log(() => {
                        if (cb) { return cb(totalSubscribers); }
                    });
                } else {
                    // if there is no subscriber, cleanup the event
                    return event.delete(() => {
                        if (cb) { return cb(0); }
                    });
                }
            });
        });
    }
}

exports.EventPublisher = EventPublisher;
