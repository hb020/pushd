const async = require('async');
const c2dm = require('c2dm');

class PushServiceC2DM {
    static initClass() {
        this.prototype.tokenFormat = /^[a-zA-Z0-9_-]+$/;
    }
    validateToken(token) {
        if (PushServiceC2DM.prototype.tokenFormat.test(token)) {
            return token;
        }
    }

    constructor(conf, logger, tokenResolver) {
        this.logger = logger;
        if (conf.concurrency == null) { conf.concurrency = 10; }
        conf.keepAlive = true;
        this.driver = new c2dm.C2DM(conf);
        this.driver.login((err, token) => {
            let queuedTasks;
            if (err) { throw Error(err); }
            [queuedTasks, this.queue] = Array.from([this.queue, async.queue((function() { return this._pushTask.apply(this, arguments); }.bind(this)), conf.concurrency)]);
            return Array.from(queuedTasks).map((task) =>
                this.queue.push(task));
        });
        // Queue into an array waiting for C2DM login to complete
        this.queue = [];
    }

    push(subscriber, subOptions, payload) {
        return this.queue.push({
            subscriber,
            subOptions,
            payload
        });
    }

    _pushTask(task, done) {
        return task.subscriber.get(info => {
            const note = {
                registration_id: info.token,
                collapse_key: (task.payload.event != null ? task.payload.event.name : undefined)
            };
            if ((task.subOptions != null ? task.subOptions.ignore_message : undefined) !== true) {
                let message, title;
                if (title = task.payload.localizedTitle(info.lang)) {
                    note['data.title'] = title;
                }
                if (message = task.payload.localizedMessage(info.lang)) {
                    note['data.message'] = message;
                }
            }
            for (let key in task.payload.data) { const value = task.payload.data[key]; note[`data.${key}`] = value; }
            return this.driver.send(note, (err, msgid) => {
                done();
                if (['InvalidRegistration', 'NotRegistered'].includes(err)) {
                    // Handle C2DM API feedback about no longer or invalid registrations
                    if (this.logger != null) {
                        this.logger.warn(`C2DM Automatic unregistration for subscriber ${task.subscriber.id}`);
                    }
                    return task.subscriber.delete();
                } else if (err) {
                    return (this.logger != null ? this.logger.error(`C2DM Error ${err} for subscriber ${task.subscriber.id}`) : undefined);
                }
            });
        });
    }
}
PushServiceC2DM.initClass();

exports.PushServiceC2DM = PushServiceC2DM;
