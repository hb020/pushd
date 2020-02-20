const apns = require('apn');

class PushServiceAPNS {
    static initClass() {
        this.prototype.tokenFormat = /^[0-9a-f]{64}$/i;
    }
    validateToken(token) {
        if (PushServiceAPNS.prototype.tokenFormat.test(token)) {
            return token.toLowerCase();
        }
    }

    constructor(conf, logger, tokenResolver) {
        this.logger = logger;
        conf.errorCallback = (errCode, note) => {
            return (this.logger != null ? this.logger.error(`APNS Error ${errCode}: ${note}`) : undefined);
        };

        // The APN library decided to change the default version of those variables in 1.5.1
        // Maintain the previous defaults in order not to break backward compat.
        if (!conf['gateway']) { conf['gateway'] = 'gateway.push.apple.com'; }
        if (!conf['address']) { conf['address'] = 'feedback.push.apple.com'; }
        this.driver = new apns.Provider(conf);

        this.payloadFilter = conf.payloadFilter;

        this.conf = conf;

        this.feedback = new apns.Feedback(conf);
        // Handle Apple Feedbacks
        this.feedback.on('feedback', feedbackData => {
            if (this.logger != null) {
                this.logger.debug(`APNS feedback returned ${feedbackData.length} devices`);
            }
            return feedbackData.forEach(item => {
                return tokenResolver('apns', item.device.toString(), subscriber => {
                    return (subscriber != null ? subscriber.get(info => {
                        if (info.updated < item.time) {
                            if (this.logger != null) {
                                this.logger.warn(`APNS Automatic unregistration for subscriber ${subscriber.id}`);
                            }
                            return subscriber.delete();
                        }
                    }) : undefined);
                });
            });
        });
    }


    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            let alert;
            const note = new apns.Notification();
            const device = new apns.Device(info.token);
            device.subscriberId = subscriber.id; // used for error logging
            if (((subOptions != null ? subOptions.ignore_message : undefined) !== true) && (alert = payload.localizedMessage(info.lang))) {
                note.alert = alert;
            }

            let badge = parseInt(payload.badge || info.badge);
            if (payload.incrementBadge) {
                badge += 1;
            }

            let {
                category
            } = payload;

            if ((category == null) && (this.conf.category != null)) {
              ({
                  category
              } = this.conf);
          }

            if (!isNaN(badge)) { note.badge = badge; }
            note.sound = payload.sound;
            note.category = category;
            if (this.payloadFilter != null) {
                for (let key in payload.data) {
                    const val = payload.data[key];
                    if (Array.from(this.payloadFilter).includes(key)) { note.payload[key] = val; }
                }
            } else {
                note.payload = payload.data;
            }
            this.driver.pushNotification(note, device);
            // On iOS we have to maintain the badge counter on the server
            if (payload.incrementBadge) {
                return subscriber.incr('badge');
            }
        });
    }
}
PushServiceAPNS.initClass();

exports.PushServiceAPNS = PushServiceAPNS;
