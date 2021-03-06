const should = require('should');
const async = require('async');
const redis = require('redis');
const { Subscriber } = require('../lib/subscriber');
const { Event } = require('../lib/event');
const { EventPublisher } = require('../lib/eventpublisher');
const { PushServices } = require('../lib/pushservices');


class PushServiceFake {
    static initClass() {
        this.prototype.total = 0;
    }
    validateToken(token) {
        return token;
    }

    push(subscriber, subOptions, info, payload) {
        return PushServiceFake.prototype.total++;
    }
}
PushServiceFake.initClass();

const createSubscriber = function(redis, cb) {
    const chars = '0123456789ABCDEF';
    let token = '';
    for (let i = 1; i <= 64; i++) { token += chars[Math.floor(Math.random() * chars.length)]; }
    return Subscriber.prototype.create(redis, {proto: 'apns', token}, cb);
};

describe('Event', function() {
    this.redis = null;
    this.event = null;
    this.publisher = null;
    this.subscriber = null;

    beforeEach(done => {
        this.redis = redis.createClient();
        return this.redis.multi()
            .select(1) // use another db for testing
            .flushdb()
            .exec(() => {
                const services = new PushServices();
                services.addService('apns', new PushServiceFake());
                this.publisher = new EventPublisher(services);
                this.event = new Event(this.redis, 'unit-test' + Math.round(Math.random() * 100000));
                return done();
        });
    });

    afterEach(done => {
        return this.event.delete(() => {
            if (this.subscriber != null) {
                return this.subscriber.delete(() => {
                    return this.redis.keys('*', (err, keys) => {
                        this.redis.quit();
                        keys.should.be.empty;
                        this.subscriber = null;
                        return done();
                    });
                });
            } else {
                return this.redis.keys('*', (err, keys) => {
                    keys.should.be.empty;
                    return done();
                });
            }
        });
    });

    describe('forEachSubscribers()', () => {
        it('should iterate of multiple pages of subscribers', doneAll => {
            const totalSubscribers = 410;
            const subscribers = [];
            return async.whilst(() => {
                return subscribers.length < totalSubscribers;
            }
            , doneCreatingSubscriber => {
                return createSubscriber(this.redis, subscriber => {
                    subscribers.push(subscriber);
                    return subscriber.addSubscription(this.event, 0, added => {
                        return doneCreatingSubscriber();
                    });
                });
            }
            , () => {
                subscribers.length.should.equal(totalSubscribers);
                const unhandledSubscribers = {};
                for (let subscriber of Array.from(subscribers)) {
                    unhandledSubscribers[subscriber.id] = true;
                }

                return this.event.forEachSubscribers((subscriber, subOptions, done) => {
                    unhandledSubscribers[subscriber.id].should.be.true;
                    delete unhandledSubscribers[subscriber.id];
                    return done();
                }
                , total => {
                    total.should.equal(totalSubscribers);
                    ((() => {
                        const result = [];
                        for (let i in unhandledSubscribers) {
                            result.push(i);
                        }
                        return result;
                    })()).length.should.equal(0);
                    return async.whilst(() => {
                        return subscribers.length > 0;
                    }
                    , doneCleaningSubscribers => {
                        return subscribers.pop().delete(() => {
                            return doneCleaningSubscribers();
                        });
                    }
                    , () => {
                        return doneAll();
                    });
                });
            });
        });

        return it('should send a broadcast event to all subscribers', doneAll => {
            const broadcastEvent = new Event(this.redis, 'broadcast');
            const totalSubscribers = 410;
            const subscribers = [];
            return async.whilst(() => {
                return subscribers.length < totalSubscribers;
            }
            , doneCreatingSubscriber => {
                return createSubscriber(this.redis, subscriber => {
                    subscribers.push(subscriber);
                    return doneCreatingSubscriber();
                });
            }
            , () => {
                subscribers.length.should.equal(totalSubscribers);
                const unhandledSubscribers = {};
                for (let subscriber of Array.from(subscribers)) {
                    unhandledSubscribers[subscriber.id] = true;
                }
                return broadcastEvent.forEachSubscribers((subscriber, subOptions, done) => {
                    unhandledSubscribers[subscriber.id].should.be.true;
                    delete unhandledSubscribers[subscriber.id];
                    return done();
                }
                , total => {
                    total.should.equal(totalSubscribers);
                    ((() => {
                        const result = [];
                        for (let i in unhandledSubscribers) {
                            result.push(i);
                        }
                        return result;
                    })()).length.should.equal(0);
                    return async.whilst(() => {
                        return subscribers.length > 0;
                    }
                    , doneCleaningSubscribers => {
                        return subscribers.pop().delete(() => {
                            return doneCleaningSubscribers();
                        });
                    }
                    , () => {
                        return doneAll();
                    });
                });
            });
        });
    });

    describe('publish()', () => {
        it('should not push anything if no subscribers', done => {
            PushServiceFake.prototype.total = 0;
            return this.publisher.publish(this.event, {msg: 'test'}, total => {
                PushServiceFake.prototype.total.should.equal(0);
                total.should.equal(0);
                return done();
            });
        });

        it('should push to one subscriber', done => {
            PushServiceFake.prototype.total = 0;
            return createSubscriber(this.redis, subscriber => {
                this.subscriber = subscriber;
                return this.subscriber.addSubscription(this.event, 0, added => {
                    added.should.be.true;
                    PushServiceFake.prototype.total.should.equal(0);
                    return this.publisher.publish(this.event, {msg: 'test'}, total => {
                        PushServiceFake.prototype.total.should.equal(1);
                        total.should.equal(1);
                        return done();
                    });
                });
            });
        });

        return it('should push unicast event to subscriber', done => {
            PushServiceFake.prototype.total = 0;

            return createSubscriber(this.redis, subscriber => {
                this.subscriber = subscriber;
                const unicastEvent = new Event(this.redis, `unicast:${this.subscriber.id}`);

                return this.publisher.publish(unicastEvent, {msg: 'test'}, total => {
                    PushServiceFake.prototype.total.should.equal(1);
                    total.should.equal(1);
                    return unicastEvent.delete(() => done());
                });
            });
        });
    });

    describe('unicastSubscriber', () => {
        return it('should provide subscriber for unicast event', doneAll => {
            const totalSubscribers = 410;
            const subscribers = [];
            return async.whilst(() => {
                return subscribers.length < totalSubscribers;
            }
            , doneCreatingSubscriber => {
                return createSubscriber(this.redis, subscriber => {
                    subscribers.push(subscriber);
                    const event = new Event(this.redis, `unicast:${subscriber.id}`);
                    event.unicastSubscriber().id.should.equal(subscriber.id);
                    return doneCreatingSubscriber();
                });
            }
            , () => {
                return async.whilst(() => {
                    return subscribers.length > 0;
                }
                , doneCleaningSubscribers => {
                    return subscribers.pop().delete(() => {
                        return doneCleaningSubscribers();
                    });
                }
                , () => {
                    return doneAll();
                });
            });
        });
    });

    describe('stats', () => {
        return it('should increment increment total field on new subscription', done => {
            return this.publisher.publish(this.event, {msg: 'test'}, () => {
                return this.event.info(info => {
                    should.not.exist(info);
                    return createSubscriber(this.redis, subscriber => {
                        this.subscriber = subscriber;
                        return this.subscriber.addSubscription(this.event, 0, added => {
                            added.should.be.true;
                            return this.publisher.publish(this.event, {msg: 'test'}, () => {
                                return this.event.info(info => {
                                    should.exist(info);
                                    if (info != null) {
                                        info.total.should.equal(1);
                                    }
                                    return done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    return describe('delete()', () => {
        return it('should unsubscribe subscribers', done => {
            return createSubscriber(this.redis, subscriber => {
                this.subscriber = subscriber;
                return this.subscriber.addSubscription(this.event, 0, added => {
                    added.should.be.true;
                    return this.event.delete(() => {
                        return this.subscriber.getSubscriptions(subcriptions => {
                            subcriptions.should.be.empty;
                            return done();
                        });
                    });
                });
            });
        });
    });
});
