const crypto = require('crypto');
const async = require('async');
const {
    Event
} = require('./event');
const logger = require('winston');

class Subscriber {
    getInstanceFromToken(redis, proto, token, cb) {
        while (!cb) { return; }

        if ((redis == null)) { throw new Error("Missing redis connection"); }
        if ((proto == null)) { throw new Error("Missing mandatory `proto' field"); }
        if ((token == null)) { throw new Error("Missing mandatory `token' field"); }

        return redis.hget("tokenmap", `${proto}:${token}`, (err, id) => {
            if (id != null) {
                // looks like this subscriber is already registered
                return redis.exists(`subscriber:${id}`, (err, exists) => {
                    if (exists) {
                        return cb(new Subscriber(redis, id));
                    } else {
                        // duh!? the global list reference an unexisting object, fix this inconsistency and return no subscriber
                        return redis.hdel("tokenmap", `${proto}:${token}`, () => {
                            return cb(null);
                        });
                    }
                });
            } else {
                return cb(null);
            }
        }); // No subscriber for this token
    }

    create(redis, fields, cb, tentatives) {
        if (tentatives == null) { tentatives = 0; }
        while (!cb) { return; }

        if ((redis == null)) { throw new Error("Missing redis connection"); }
        if (((fields != null ? fields.proto : undefined) == null)) { throw new Error("Missing mandatory `proto' field"); }
        if (((fields != null ? fields.token : undefined) == null)) { throw new Error("Missing mandatory `token' field"); }

        if (tentatives > 10) {
            // exceeded the retry limit
            throw new Error("Can't find free uniq id");
        }

        // verify if token is already registered
        return Subscriber.prototype.getInstanceFromToken(redis, fields.proto, fields.token, subscriber => {
            if (subscriber != null) {
                // this subscriber is already registered
                delete fields.token;
                delete fields.proto;
                return subscriber.set(fields, () => {
                    let created;
                    return cb(subscriber, (created=false), tentatives);
                });
            } else {
                // register the subscriber using a randomly generated id
                return crypto.randomBytes(8, (ex, buf) => {
                    // generate a base64url random uniq id
                    const id = buf.toString('base64').replace(/\=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
                    return redis.watch(`subscriber:${id}`, () => {
                        return redis.exists(`subscriber:${id}`, (err, exists) => {
                            if (exists) {
                                // already exists, rollback and retry with another id
                                return redis.discard(() => {
                                    return Subscriber.prototype.create(redis, fields, cb, tentatives + 1);
                                });
                            } else {
                                fields.created = (fields.updated = Math.round(new Date().getTime() / 1000));
                                return redis.multi()
                                    // register subscriber token to db id
                                    .hsetnx("tokenmap", `${fields.proto}:${fields.token}`, id)
                                    // register subscriber to global list
                                    .zadd("subscribers", 0, id)
                                    // save fields
                                    .hmset(`subscriber:${id}`, fields)
                                    .exec((err, results) => {
                                        if (results === null) {
                                            // Transction discarded due to a parallel creation of the watched subscriber key
                                            // Try again in order to get the peer created subscriber
                                            return Subscriber.prototype.create(redis, fields, cb, tentatives + 1);
                                        }
                                        if (!results[0]) {
                                            // Unlikly race condition: another client registered the same token at the same time
                                            // Rollback and retry the registration so we can return the peer subscriber id
                                            return redis.del(`subscriber:${id}`, () => {
                                                return Subscriber.prototype.create(redis, fields, cb, tentatives + 1);
                                            });
                                        } else {
                                            // done
                                            let created;
                                            return cb(new Subscriber(redis, id), (created=true), tentatives);
                                        }
                                });
                            }
                        });
                    });
                });
            }
        });
    }

    constructor(redis, id) {
        this.redis = redis;
        this.id = id;
        this.info = null;
        this.key = `subscriber:${this.id}`;
    }

    delete(cb) {
        return this.redis.multi()
            // get subscriber's token
            .hmget(this.key, 'proto', 'token')
            // gather subscriptions
            .zrange(`subscriber:${this.id}:evts`, 0, -1)
            .exec((err, results) => {
                let eventName;
                const [proto, token] = Array.from(results[0]);
                const events = results[1];
                const multi = this.redis.multi()
                    // remove from subscriber token to id map
                    .hdel("tokenmap", `${proto}:${token}`)
                    // remove from global subscriber list
                    .zrem("subscribers", this.id)
                    // remove subscriber info hash
                    .del(this.key)
                    // remove subscription list
                    .del(`${this.key}:evts`);

                // unsubscribe subscriber from all subscribed events
                for (eventName of Array.from(events)) {
                    multi.zrem(`event:${eventName}:subs`, this.id);
                    // count subscribers after zrem
                    multi.zcard(`event:${eventName}:subs`);
                }

                return multi.exec((err, results) => {
                    this.info = null; // flush cache
                    // check if some events have been rendered empty
                    const emptyEvents = [];
                    for (let i = 0; i < events.length; i++) {
                        eventName = events[i];
                        if (results[4 + i + (i * 1) + 1] === 0) {
                            emptyEvents.push(new Event(this.redis, eventName));
                        }
                    }

                    return async.forEach(emptyEvents, ((evt, done) => evt.delete(done)), () => {
                        if (cb) { return cb(results[1] === 1); }
                    });
                });
        }); // true if deleted, false if did exist
    }

    get(cb) {
        while (!cb) { return; }
        // returned cached value or perform query
        if (this.info != null) {
            return cb(this.info);
        } else {
            return this.redis.hgetall(this.key, (err, info) => {
                this.info = info;
                if ((this.info != null ? this.info.updated : undefined) != null) { // subscriber exists
                    // transform numeric value to number type
                    for (let key of Object.keys(this.info || {})) {
                        const value = this.info[key];
                        const num = parseInt(value);
                        this.info[key] = (num + '') === value ? num : value;
                    }
                    return cb(this.info);
                } else {
                    return cb(this.info = null);
                }
            }); // null if subscriber doesn't exist + flush cache
        }
    }

    set(fieldsAndValues, cb) {
        // TODO handle token update needed for Android
        if (fieldsAndValues.token != null) { throw new Error("Can't modify `token` field"); }
        if (fieldsAndValues.proto != null) { throw new Error("Can't modify `proto` field"); }
        fieldsAndValues.updated = Math.round(new Date().getTime() / 1000);
        return this.redis.multi()
            // check subscriber existance
            .zscore("subscribers", this.id)
            // edit fields
            .hmset(this.key, fieldsAndValues)
            .exec((err, results) => {
                this.info = null; // flush cache
                if (results && (results[0] != null)) { // subscriber exists?
                    if (cb) { return cb(true); }
                } else {
                    // remove edited fields
                    return this.redis.del(this.key, () => {
                        if (cb) { return cb(null); }
                    });
                }
        }); // null if subscriber doesn't exist
    }

    incr(field, cb) {
        return this.redis.multi()
            // check subscriber existance
            .zscore("subscribers", this.id)
            // increment field
            .hincrby(this.key, field, 1)
            .exec((err, results) => {
                if (results[0] != null) { // subscriber exists?
                    if (this.info != null) { this.info[field] = results[1]; } // update cache field
                    if (cb) { return cb(results[1]); }
                } else {
                    this.info = null; // flush cache
                    // remove edited field
                    return this.redis.del(this.key, () => {
                        if (cb) { return cb(null); }
                    });
                }
        }); // null if subscriber doesn't exist
    }

    getSubscriptions(cb) {
        if (!cb) { return; }
        return this.redis.multi()
            // check subscriber existance
            .zscore("subscribers", this.id)
            // gather all subscriptions
            .zrange(`${this.key}:evts`, 0, -1, 'WITHSCORES')
            .exec((err, results) => {
                if (results[0] != null) { // subscriber exists?
                    const subscriptions = [];
                    const eventsWithOptions = results[1];
                    if (eventsWithOptions != null) {
                        for (let i = 0; i < eventsWithOptions.length; i += 2) {
                            const eventName = eventsWithOptions[i];
                            subscriptions.push({
                                event: new Event(this.redis, eventName),
                                options: parseInt(eventsWithOptions[i + 1], 10)
                            });
                        }
                    }
                    return cb(subscriptions);
                } else {
                    return cb(null);
                }
        }); // null if subscriber doesn't exist
    }

    getSubscription(event, cb) {
        if (!cb) { return; }
        return this.redis.multi()
            // check subscriber existance
            .zscore("subscribers", this.id)
            // gather all subscriptions
            .zscore(`${this.key}:evts`, event.name)
            .exec((err, results) => {
                if ((results[0] != null) && (results[1] != null)) { // subscriber and subscription exists?
                    return cb({
                        event,
                        options: parseInt(results[1], 10)
                    });
                } else {
                    return cb(null);
                }
        }); // null if subscriber doesn't exist
    }

    addSubscription(event, options, cb) {
        return this.redis.multi()
            // check subscriber existance
            .zscore("subscribers", this.id)
            // add event to subscriber's subscriptions list
            .zadd(`${this.key}:evts`, options, event.name)
            // add subscriber to event's subscribers list
            .zadd(`${event.key}:subs`, options, this.id)
            // set the event created field if not already there (event is lazily created on first subscription)
            .hsetnx(event.key, "created", Math.round(new Date().getTime() / 1000))
            // lazily add event to the global event list
            .sadd("events", event.name)
            .exec((err, results) => {
                if (results[0] != null) { // subscriber exists?
                    logger.verbose(`Registered subscriber ${this.id} to event ${event.name}`);
                    if (cb) { return cb(results[1] === 1); }
                } else {
                    // Tried to add a sub on an unexisting subscriber, remove just added sub
                    // This is an exception so we don't first check subscriber existance before to add sub,
                    // but we manually rollback the subscription in case of error
                    this.redis.multi()
                        // remove the wrongly created subs subscriber relation
                        .del(`${this.key}:evts`, event.name)
                        // remove the subscriber from the event's subscribers list
                        .zrem(`${event.key}:subs`, this.id)
                        // check if the subscriber list still exist after previous zrem
                        .zcard(`${event.key}:subs`)
                        .exec((err, results) => {
                            if (results[2] === 0) {
                                // The event subscriber list is now empty, clean it
                                return event.delete();
                            }
                    }); // TOFIX possible race condition
                    if (cb) { return cb(null); }
                }
        }); // null if subscriber doesn't exist
    }

    removeSubscription(event, cb) {
        return this.redis.multi()
            // check subscriber existence
            .zscore("subscribers", this.id)
            // remove event from subscriber's subscriptions list
            .zrem(`${this.key}:evts`, event.name)
            // remove the subscriber from the event's subscribers list
            .zrem(`${event.key}:subs`, this.id)
            // check if the subscriber list still exist after previous zrem
            .zcard(`${event.key}:subs`)
            .exec((err, results) => {

                if (err) {
                  logger.verbose(`Error removing Subscription: ${err}`);
                  cb(err);
              }

                // if results[3] is 0
                //     # The event subscriber list is now empty, clean it
                //     event.delete() # TOFIX possible race condition

                if (results[0] != null) { // subscriber exists?
                    const wasRemoved = results[1] === 1; // true if removed, false if wasn't subscribed
                    if (wasRemoved) {
                        logger.verbose(`Subscriber ${this.id} unregistered from event ${event.name}`);
                    }
                    if (cb) { return cb(null); }
                } else {
                    logger.verbose(`Subscriber ${this.id} doesn't exist`);
                    if (cb) { return cb("Not exists"); }
                }
        }); // null if subscriber doesn't exist
    }
}


exports.Subscriber = Subscriber;
