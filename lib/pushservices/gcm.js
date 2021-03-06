const gcm = require('node-gcm');

class PushServiceGCM {
    validateToken(token) {
        return token;
    }

    constructor(conf, logger, tokenResolver) {
        this.logger = logger;
        if (conf.concurrency == null) { conf.concurrency = 10; }
        this.driver = new gcm.Sender(conf.key, conf.options);
        this.multicastQueue = {};
    }

    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            const messageKey = `${payload.id}-${info.lang || 'int'}-${!!(subOptions != null ? subOptions.ignore_message : undefined)}`;

            // Multicast supports up to 1000 subscribers
            if (messageKey in this.multicastQueue && (this.multicastQueue[messageKey].tokens.length >= 1000)) {
                this.send(messageKey);
            }

            if (messageKey in this.multicastQueue) {
                this.multicastQueue[messageKey].tokens.push(info.token);
                return this.multicastQueue[messageKey].subscribers.push(subscriber);
            } else {
                const note = new gcm.Message();
                note.collapseKey = payload.event != null ? payload.event.name : undefined;
                if ((subOptions != null ? subOptions.ignore_message : undefined) !== true) {
                    // TODO: Do we want data messages or notification messages?  This was sending
                    //  data messages but is now updated to send notification messages.
                    //  See https://firebase.google.com/docs/cloud-messaging/concept-options.
                    let title, body, image;
                    if (title = payload.localizedTitle(info.lang)) {
                        note.addNotification('title', title);
                    }
                    if (body = payload.localizedMessage(info.lang)) {
                        note.addNotification('body', body);
                    }
                    if (image = payload.image) {
                        note.addNotification('image', image);
                    }
                }
                let badge;
                badge = parseInt(payload.badge);
                if (!isNaN(badge)) {
                    note.addData( 'badge', badge);   
                }
                for (let key in payload.data) { const value = payload.data[key]; note.addData(key, value); }
                this.multicastQueue[messageKey] = {tokens: [info.token], subscribers: [subscriber], note};

                // Give half a second for tokens to accumulate
                return this.multicastQueue[messageKey].timeoutId = setTimeout((() => this.send(messageKey)), 500);
            }
        });
    }

    send(messageKey) {
        const message = this.multicastQueue[messageKey];
        delete this.multicastQueue[messageKey];
        clearTimeout(message.timeoutId);

        return this.driver.send(message.note, message.tokens, 4, (err, multicastResult) => {
            if ((multicastResult == null)) {
                return (this.logger != null ? this.logger.error("GCM Error: empty response") : undefined);
            } else if ('results' in multicastResult) {
                return Array.from(multicastResult.results).map((result, i) =>
                    this.handleResult(result, message.subscribers[i]));
            } else {
                // non multicast result
                return this.handleResult(multicastResult, message.subscribers[0]);
            }
    });
    }

    handleResult(result, subscriber) {
        if (result.registration_id != null) {
            // Remove duplicated subscriber for one device
            if (result.registration_id !== subscriber.info.token) { return subscriber.delete(); }
        } else if (result.messageId || result.message_id) {
            // if result.canonicalRegistrationId
                // TODO: update subscriber token
        } else {
            const error = result.error || result.errorCode;
            if ((error === "NotRegistered") || (error === "InvalidRegistration")) {
                if (this.logger != null) {
                    this.logger.warn(`GCM Automatic unregistration for subscriber ${subscriber.id}`);
                }
                return subscriber.delete();
            } else {
                return (this.logger != null ? this.logger.error(`GCM Error: ${error}`) : undefined);
            }
        }
    }
}



exports.PushServiceGCM = PushServiceGCM;
