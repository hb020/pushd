const apns = require('@parse/node-apn');

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

        // Forced move to HTTP/2
        // this.logger.silly(`APNS conf ${JSON.stringify(conf,null,null)}`);
        this.driver = new apns.Provider(conf);

        this.payloadFilter = conf.payloadFilter;

        this.conf = conf;
    }


    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            let alert;
            const note = new apns.Notification();
            const device = info.token;
            //device.subscriberId = subscriber.id; // used for error logging
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

            // I probably need a topic. Look in the config
            if (this.conf.topic != null) {
            	note.topic = this.conf.topic;
            }
            // override the topic with the payload
            if (payload.topic != null) {
            	note.topic = payload.topic;
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
            // this.logger.silly(`APNS will send payload ${JSON.stringify(note,null,null)}, ${device}`); // only note.payload will not show up!
            // this.logger.silly(`APNS will send headers: ${JSON.stringify(note.headers())}`); // here you have the headers
            this.driver.send(note, device).then( (response) => {
                response.sent.forEach( (token) => {
                	// this.logger.silly(`APNS sent OK for ${JSON.stringify(token,null,null)}`);
                });
                response.failed.forEach( (failure) => {
                	this.logger.error(`APNS send Failed for ${JSON.stringify(failure,null,null)}`);
                });
              });
            // On iOS we have to maintain the badge counter on the server
            if (payload.incrementBadge) {
                return subscriber.incr('badge');
            }
        });
    }
}
PushServiceAPNS.initClass();

exports.PushServiceAPNS = PushServiceAPNS;
