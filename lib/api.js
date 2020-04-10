const async = require('async');
const logger = require('winston');

const filterFields = function(params) {
    const fields = {};
    for (let key of Object.keys(params || {})) { const val = params[key]; if (['proto', 'token', 'lang', 'badge', 'category'].includes(key)) { fields[key] = val; } }
    return fields;
};

exports.setupRestApi = function(app, createSubscriber, getEventFromId, authorize, testSubscriber, eventPublisher, checkStatus) {
    if (authorize == null) { authorize = function(realm) {}; }

    // subscriber registration
    app.post('/subscribers', authorize('register'), function(req, res) {
        logger.verbose("Registering subscriber: " + JSON.stringify(req.body));
        try {
            const fields = filterFields(req.body);
            return createSubscriber(fields, (subscriber, created) => subscriber.get(function(info) {
                info.id = subscriber.id;
                res.header('Location', `/subscriber/${subscriber.id}`);
                return res.status(created ? 201 : 200).json(info);
            }));
        } catch (error) {
            logger.error(`Creating subscriber failed: ${error.message}`);
            return res.status(400).json({error: error.message});
        }
    });

    // Get subscriber info
    app.get('/subscriber/:subscriber_id', authorize('register'), (req, res) => req.subscriber.get(function(fields) {
        if ((fields == null)) {
            logger.error(`No subscriber ${req.subscriber.id}`);
        } else {
            logger.verbose(`Subscriber ${req.subscriber.id} info: ` + JSON.stringify(fields));
        }
        return res.status(fields != null ? 200 : 404).json(fields);
    }));

    // Edit subscriber info
    app.post('/subscriber/:subscriber_id', authorize('register'), function(req, res) {
        logger.verbose(`Setting new properties for ${req.subscriber.id}: ` + JSON.stringify(req.body));
        const fields = filterFields(req.body);
        return req.subscriber.set(fields, function(edited) {
            if (!edited) {
                logger.error(`No subscriber ${req.subscriber.id}`);
            }
            return res.sendStatus(edited ? 204 : 404);
        });
    });

    // Unregister subscriber
    app.delete('/subscriber/:subscriber_id', authorize('register'), (req, res) => req.subscriber.delete(function(deleted) {
        if (!deleted) {
            logger.error(`No subscriber ${req.subscriber.id}`);
        }
        return res.sendStatus(deleted ? 204 : 404);
    }));

    app.post('/subscriber/:subscriber_id/test', authorize('register'), function(req, res) {
        testSubscriber(req.subscriber);
        return res.sendStatus(201);
    });

    // Get subscriber subscriptions
    app.get('/subscriber/:subscriber_id/subscriptions', authorize('register'), (req, res) => req.subscriber.getSubscriptions(function(subs) {
        if (subs != null) {
            const subsAndOptions = {};
            for (let sub of Array.from(subs)) {
                subsAndOptions[sub.event.name] = {ignore_message: (sub.options & sub.event.OPTION_IGNORE_MESSAGE) !== 0};
            }
            logger.verbose(`Status of ${req.subscriber.id}: ` + JSON.stringify(subsAndOptions));
            return res.json(subsAndOptions);
        } else {
            logger.error(`No subscriber ${req.subscriber.id}`);
            return res.sendStatus(404);
        }
    }));

    // Set subscriber subscriptions
    app.post('/subscriber/:subscriber_id/subscriptions', authorize('register'), function(req, res) {
        let error, event, options;
        const subsToAdd = req.body;
        logger.verbose(`Setting subscriptions for ${req.subscriber.id}: ` + JSON.stringify(req.body));
        for (let eventId in req.body) {
            const optionsDict = req.body[eventId];
            try {
                event = getEventFromId(eventId);
                options = 0;
                if ((optionsDict != null) && (typeof(optionsDict) === 'object') && optionsDict.ignore_message) {
                    options |= event.OPTION_IGNORE_MESSAGE;
                }
                subsToAdd[event.name] = {event, options};
            } catch (error1) {
                error = error1;
                logger.error(`Failed to set subscriptions for ${req.subscriber.id}: ${error.message}`);
                res.status(400).json({error: error.message});
                return;
            }
        }

        return req.subscriber.getSubscriptions(function(subs) {
            let sub;
            if ((subs == null)) {
                logger.error(`No subscriber ${req.subscriber.id}`);
                res.sendStatus(404);
                return;
            }

            const tasks = [];

            for (sub of Array.from(subs)) {
                if (sub.event.name in subsToAdd) {
                    const subToAdd = subsToAdd[sub.event.name];
                    if (subToAdd.options !== sub.options) {
                        tasks.push(['set', subToAdd.event, subToAdd.options]);
                    }
                    delete subsToAdd[sub.event.name];
                } else {
                    tasks.push(['del', sub.event, 0]);
                }
            }

            for (let eventName in subsToAdd) {
                sub = subsToAdd[eventName];
                tasks.push(['add', sub.event, sub.options]);
            }

            return async.every(tasks, function(task, callback) {
                let action;
                [action, event, options] = Array.from(task);
                if (action === 'add') {
                    return req.subscriber.addSubscription(event, options, added => callback(added));
                } else if (action === 'del') {
                    return req.subscriber.removeSubscription(event, deleted => callback(deleted));
                } else if (action === 'set') {
                    return req.subscriber.addSubscription(event, options, added => callback(!added));
                }
            } // should return false
            , function(result) {
                if (!result) {
                    logger.error(`Failed to set properties for ${req.subscriber.id}`);
                }
                return res.sendStatus(result ? 204 : 400);
            });
        });
    });

    // Get subscriber subscription options
    app.get('/subscriber/:subscriber_id/subscriptions/:event_id', authorize('register'), (req, res) => req.subscriber.getSubscription(req.event, function(options) {
        if (options != null) {
            return res.json({ignore_message: (options & req.event.OPTION_IGNORE_MESSAGE) !== 0});
        } else {
            logger.error(`No subscriber ${req.subscriber.id}`);
            return res.sendStatus(404);
        }
    }));

    // Subscribe a subscriber to an event
    app.post('/subscriber/:subscriber_id/subscriptions/:event_id', authorize('register'), function(req, res) {
        let options = 0;
        if (parseInt(req.body.ignore_message)) {
            options |= req.event.OPTION_IGNORE_MESSAGE;
        }
        return req.subscriber.addSubscription(req.event, options, function(added) {
            if (added != null) { // added is null if subscriber doesn't exist
                return res.sendStatus(added ? 201 : 204);
            } else {
                logger.error(`No subscriber ${req.subscriber.id}`);
                return res.sendStatus(404);
            }
        });
    });

    // Unsubscribe a subscriber from an event
    app.delete('/subscriber/:subscriber_id/subscriptions/:event_id', authorize('register'), (req, res) => req.subscriber.removeSubscription(req.event, function(errorDeleting) {
        if (errorDeleting != null) {
            logger.error(`No subscriber ${req.subscriber.id} or not subscribed to ${req.event.name}`);
        }

        // TODO: add the check for empty events and the requisite event.delete() call here.

        return res.sendStatus(errorDeleting ? 404 : 204);
    }));

    // Event stats
    app.get('/event/:event_id', authorize('register'), (req, res) => req.event.info(function(info) {
        if ((info == null)) {
            logger.error(`No event ${req.event.name}`);
        } else {
            logger.verbose(`Event ${req.event.name} info: ` + JSON.stringify(info));
        }
        return res.status(info != null ? 200 : 404).json(info);
    }));

    // Publish an event
    app.post('/event/:event_id', authorize('publish'), function(req, res) {
        res.sendStatus(204);
        return eventPublisher.publish(req.event, req.body);
    });

    // Delete an event
    app.delete('/event/:event_id', authorize('publish'), (req, res) => req.event.delete(function(deleted) {
        if (!deleted) {
            logger.error(`No event ${req.event.name}`);
        }
        if (deleted) {
            return res.sendStatus(204);
        } else {
            return res.sendStatus(404);
        }
    }));

    // Server status
    return app.get('/status', authorize('register'), function(req, res) {
        if (checkStatus()) {
            return res.sendStatus(204);
        } else {
            return res.sendStatus(503);
        }
    });
};
