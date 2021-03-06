const should = require('should');
const { Subscriber } = require('../lib/subscriber');
const { Event } = require('../lib/event');
const redis = require('redis');

const createSubscriber = function(redisClient, proto, token, cb) {
    const info = {proto, token};
    try {
        return Subscriber.prototype.create(redisClient, info, cb);
    } catch (e) {
        redisClient.quit();
        throw e;
    }
};

describe('Subscriber', function() {
    this.redis = null;
    this.event = null;
    this.subscriber = null;
    this.testEvent = null;
    this.testEvent2 = null;

    const xdescribe = (title, fn) => {
        return describe(title, () => {
            fn();

            before(done => {
                this.redis = redis.createClient();
                return this.redis.multi()
                    .select(1)
                    .exec(() => {
                        return createSubscriber(this.redis, 'apns', 'FE66489F304DC75B8D6E8200DFF8A456E8DAEACEC428B427E9518741C92C6660', (subscriber, created, tentatives) => {
                            this.subscriber = subscriber;
                            this.subscriber.should.be.an.instanceof(Subscriber);
                            created.should.be.true;
                            tentatives.should.equal(0);
                            return done();
                        });
                });
            });

            return after(done => {
                return this.subscriber.delete(() => {
                    return this.redis.keys('*', (err, keys) => {
                        keys.should.be.empty;
                        return done();
                    });
                });
            });
        });
    };


    xdescribe('register twice', () => {
        return it('should not create a second object', done => {
            return createSubscriber(this.redis, 'apns', 'FE66489F304DC75B8D6E8200DFF8A456E8DAEACEC428B427E9518741C92C6660', (subscriber, created, tentatives) => {
                subscriber.should.be.an.instanceof(Subscriber);
                created.should.be.false;
                tentatives.should.equal(0);
                subscriber.id.should.equal(this.subscriber.id);
                return done();
            });
        });
    });

    xdescribe('get instance from token', () => {
        it('should return the instance if already registered', done => {
            return Subscriber.prototype.getInstanceFromToken(this.subscriber.redis, 'apns', 'FE66489F304DC75B8D6E8200DFF8A456E8DAEACEC428B427E9518741C92C6660', subscriber => {
                subscriber.should.be.an.instanceof(Subscriber);
                subscriber.id.should.equal(this.subscriber.id);
                return done();
            });
        });
        return it('should return null if not registered', done => {
            return Subscriber.prototype.getInstanceFromToken(this.subscriber.redis, 'apns', 'FE66489F304DC75B8D6E8200DFF8A456E8DAEACEC428B427E9518741C92C6661', subscriber => {
                should.not.exist(subscriber);
                return done();
            });
        });
    });

    xdescribe('defaults', () => {
        return it('should have some default values', done => {
            return this.subscriber.get(fields => {
                should.exist(fields);
                fields.should.have.property('proto');
                fields.should.have.property('token');
                fields.should.have.property('created');
                fields.should.have.property('updated');
                fields.should.not.have.property('badge');
                return done();
            });
        });
    });

    xdescribe('incr()', () => {
        it('should not increment field of an unexisting subscriber', done => {
            const subscriber = new Subscriber(this.redis, 'invalidid');
            return subscriber.incr('badge', value => {
                should.not.exist(value);
                return done();
            });
        });
        it('should increment unexisting field to 1', done => {
            return this.subscriber.incr('badge', value => {
                value.should.equal(1);
                return done();
            });
        });
        return it('should increment an existing field', done => {
            return this.subscriber.incr('badge', value => {
                value.should.equal(2);
                return done();
            });
        });
    });

    xdescribe('set()', () => {
        it('should not edit an unexisting subscriber', done => {
            const subscriber = new Subscriber(this.subscriber.redis, 'invalidid');
            return subscriber.set({lang: 'us'}, edited => {
                should.not.exist(edited);
                return done();
            });
        });
        return it('should edit an existing subscriber', done => {
            return this.subscriber.set({lang: 'us', badge: 5}, edited => {
                edited.should.be.true;
                return this.subscriber.get(fields => {
                    should.exist(fields);
                    fields.lang.should.equal('us');
                    fields.badge.should.equal(5);
                    return done();
                });
            });
        });
    });

    xdescribe('delete()', () => {
        it('should delete correctly', done => {
            return this.subscriber.delete(deleted => {
                deleted.should.be.true;
                return done();
            });
        });
        it('should not delete an already deleted subscription', done => {
            return this.subscriber.delete(deleted => {
                deleted.should.be.false;
                return done();
            });
        });
        return it('should no longer exist', done => {
            return this.subscriber.get(fields => {
                should.not.exist(fields);
                return done();
            });
        });
    });

    xdescribe('getSubscriptions()', () => {
        before(() => {
            this.testEvent = new Event(this.redis, 'unit-test' +  Math.round(Math.random() * 100000));
            return this.testEvent2 = new Event(this.redis, 'unit-test' +  Math.round(Math.random() * 100000));
        });

        it('should return null on unexisting subscriber', done => {
            const subscriber = new Subscriber(this.redis, 'invalidid');
            return subscriber.getSubscriptions(subs => {
                should.not.exist(subs);
                return done();
            });
        });
        it('should initially return an empty subscriptions list', done => {
            return this.subscriber.getSubscriptions(subs => {
                should.exist(subs);
                subs.should.be.empty;
                return done();
            });
        });
        it('should return a subscription once subscribed', done => {
            return this.subscriber.addSubscription(this.testEvent, 0, added => {
                added.should.be.true;
                return this.subscriber.getSubscriptions(subs => {
                    subs.should.have.length(1);
                    subs[0].event.name.should.equal(this.testEvent.name);
                    return done();
                });
            });
        });
        it('should return the added subscription with getSubscription()', done => {
            return this.subscriber.getSubscription(this.testEvent, sub => {
                sub.should.have.property('event');
                sub.event.should.be.an.instanceof(Event);
                sub.event.name.should.equal(this.testEvent.name);
                sub.should.have.property('options');
                sub.options.should.equal(0);
                return done();
            });
        });
        return it('should return null with getSubscription() on an unsubscribed event', done => {
            return this.subscriber.getSubscription(this.testEvent2, sub => {
                should.not.exist(sub);
                return done();
            });
        });
    });

    xdescribe('addSubscription()', () => {
        before(() => {
            return this.testEvent = new Event(this.redis, 'unit-test' +  Math.round(Math.random() * 100000));
        });

        it('should not add subscription on unexisting subscriber', done => {
            const subscriber = new Subscriber(this.subscriber.redis, 'invalidid');
            return subscriber.addSubscription(this.testEvent, 0, added => {
                should.not.exist(added);
                return done();
            });
        });
        it('should add subscription correctly', done => {
            return this.subscriber.addSubscription(this.testEvent, 0, added => {
                added.should.be.true;
                return done();
            });
        });
        return it('should not add an already subscribed event', done => {
            return this.subscriber.addSubscription(this.testEvent, 0, added => {
                added.should.be.false;
                return done();
            });
        });
    });

    return xdescribe('removeSubscription', () => {
        before(() => {
            return this.testEvent = new Event(this.redis, 'unit-test' +  Math.round(Math.random() * 100000));
        });

        after(done => {
            return this.testEvent.delete(() => done());
        });

        it('should not remove subscription on an unexisting subscription', done => {
            const subscriber = new Subscriber(this.subscriber.redis, 'invalidid');
            return subscriber.removeSubscription(this.testEvent, errDeleting => {
                should.exist(errDeleting);
                return done();
            });
        });
        it('should not remove an unsubscribed event', done => {
            return this.subscriber.removeSubscription(this.testEvent, errDeleting => {
                should.not.exist(errDeleting);
                return done();
            });
        });
        it('should remove an subscribed event correctly', done => {
            return this.subscriber.addSubscription(this.testEvent, 0, added => {
                added.should.be.true;
                return this.subscriber.removeSubscription(this.testEvent, errDeleting => {
                    should.not.exist(errDeleting);
                    return done();
                });
            });
        });
        return it('should not remove an already removed subscription', done => {
            return this.subscriber.removeSubscription(this.testEvent, errDeleting => {
                should.not.exist(errDeleting);
                return done();
            });
        });
    });
});
