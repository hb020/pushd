const async = require('async');
const logger = require('winston');

class Event {
    static initClass() {
        this.prototype.OPTION_IGNORE_MESSAGE = 1;
        this.prototype.name_format = /^[a-zA-Z0-9@:._-]{1,100}$/;
        this.prototype.unicast_format = /^unicast:(.+)$/;
    }

    constructor(redis, name) {
        this.redis = redis;
        this.name = name;
        if ((this.redis == null)) { throw new Error("Missing redis connection"); }
        if (!Event.prototype.name_format.test(this.name)) { throw new Error('Invalid event name ' + this.name); }
        this.key = `event:${this.name}`;
    }

    info(cb) {
        while (!cb) { return; }
        return this.redis.multi()
            // event info
            .hgetall(this.key)
            // subscribers total
            .zcard(`${this.key}:subs`)
            .exec((err, results) => {
                if (((() => {
                    const result = [];
                    for (let f of Object.keys(results[0] || {})) {
                        result.push(f);
                    }
                    return result;
                })()).length) {
                    const info = {total: results[1]};
                    // transform numeric value to number type
                    for (let key of Object.keys(results[0] || {})) {
                        const value = results[0][key];
                        const num = parseInt(value);
                        info[key] = (num + '') === value ? num : value;
                    }
                    return cb(info);
                } else {
                    return cb(null);
                }
        });
    }

    unicastSubscriber() {
        let matches;
        const {
            Subscriber
        } = require('./subscriber');
        if ((matches = Event.prototype.unicast_format.exec(this.name)) != null) {
            const subscriberId = matches[1];
            return new Subscriber(this.redis, subscriberId);
        } else {
            return null;
        }
    }

    exists(cb) {
        let subscriber;
        if (this.name === 'broadcast') {
            return cb(true);
        } else if ((subscriber = this.unicastSubscriber()) != null) {
            return subscriber.get(fields => {
                return cb(fields != null);
            });
        } else {
            return this.redis.sismember("events", this.name, (err, exists) => {
                return cb(exists);
            });
        }
    }

    delete(cb) {
        logger.verbose(`Deleting event ${this.name}`);

        const performDelete = () => {
            return this.redis.multi()
                // delete event's info hash
                .del(this.key)
                // remove event from global event list
                .srem("events", this.name)
                .exec(function(err, results) {
                    if (cb) { return cb(results[1] > 0); }
            });
        };


        if (this.unicastSubscriber() != null) {
            return performDelete();
        } else {
            return this.forEachSubscribers((subscriber, subOptions, doneCb) => {
                // action
                return subscriber.removeSubscription(this, doneCb);
            }
                // subscriberCount += 1
            , totalSubscribers=> {
                // finished
                logger.verbose(`Unsubscribed ${totalSubscribers} subscribers from ${this.name}`);
                return performDelete();
            });
        }
    }

    log(cb) {
        return this.redis.multi()
            // account number of sent notification since event creation
            .hincrby(this.key, "total", 1)
            // store last notification date for this event
            .hset(this.key, "last", Math.round(new Date().getTime() / 1000))
            .exec(() => {
                if (cb) { return cb(); }
        });
    }

    // Performs an action on each subscriber subscribed to this event
    forEachSubscribers(action, finished) {
        let subscriber;
        const {
            Subscriber
        } = require('./subscriber');
        if ((subscriber = this.unicastSubscriber()) != null) {
            // if event is unicast, do not treat score as subscription option, ignore it
            return action(subscriber, {}, function() { if (finished) { return finished(1); } });
        } else {
            let performAction;
            if (this.name === 'broadcast') {
                // if event is broadcast, do not treat score as subscription option, ignore it
                performAction = (subscriberId, subOptions) => {
                    return doneCb => {
                        return action(new Subscriber(this.redis, subscriberId), {}, (doneCb));
                    };
                };
            } else {
                performAction = (subscriberId, subOptions) => {
                    const options = {ignore_message: (subOptions & Event.prototype.OPTION_IGNORE_MESSAGE) !== 0};
                    return doneCb => {
                        return action(new Subscriber(this.redis, subscriberId), options, doneCb);
                    };
                };
            }

            const subscribersKey = this.name === 'broadcast' ? 'subscribers' : `${this.key}:subs`;

            const perPage = 100;
            let page = 0;

            return this.redis.zcard(subscribersKey, (err, subcount) => {
              const total = subcount;
              const totalPages = Math.ceil((subcount*1.0)/perPage);
              return async.whilst(() => {
                  return  page < totalPages;
              }
              , chunkDone => {
                  // treat subscribers by packs of 100 with async to prevent from blocking the event loop
                  // for too long on large subscribers lists
                  return this.redis.zrange(subscribersKey, Math.max(0,total - ((page+1)*perPage)), total - ((page)*perPage)-1, 'WITHSCORES', (err, subscriberIdsAndOptions) => {
                      const tasks = [];
                      for (let i = 0; i < subscriberIdsAndOptions.length; i += 2) {
                          const id = subscriberIdsAndOptions[i];
                          tasks.push(performAction(id, subscriberIdsAndOptions[i + 1]));
                      }
                      return async.series(tasks, () => {
                          //total += subscriberIdsAndOptions.length / 2
                          page++;
                          return chunkDone();
                      });
                  });
              }
              , () => {
                  // all done
                  if (finished) { return finished(subcount); }
              });
            });
        }
    }
}
Event.initClass();

exports.Event = Event;
