const mpns = require('mpns');

class PushServiceMPNS {
    static initClass() {
        this.prototype.tokenFormat = /^https?:\/\/[a-zA-Z0-9-.]+\.notify\.live\.net\/\S{0,500}$/;
    }
    validateToken(token) {
        if (PushServiceMPNS.prototype.tokenFormat.test(token)) {
            return token;
        }
    }

    constructor(conf, logger, tokenResolver) {
        this.conf = conf;
        this.logger = logger;
        if (this.conf.type == null) { this.conf.type = "toast"; }
        if ((this.conf.type === "tile") && !this.conf.tileMapping) {
            throw new Error("Invalid MPNS configuration: missing `tileMapping` for `tile` type");
        }
    }

    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            let sender;
            let e;
            let note = {};
            switch (this.conf.type) {
                case "toast":
                    if ((subOptions != null ? subOptions.ignore_message : undefined) !== true) {
                        sender = mpns.sendToast;
                        note.text1 = payload.localizedTitle(info.lang) || ''; // prevents exception
                        note.text2 = payload.localizedMessage(info.lang);
                        if (this.conf.paramTemplate && (info.version >= 7.5)) {
                            try {
                                note.param = payload.compileTemplate(this.conf.paramTemplate);
                            } catch (error1) {
                                e = error1;
                                this.logger.error(`Cannot compile MPNS param template: ${e}`);
                                return;
                            }
                        }
                    }
                    break;

                case "tile": // live tile under WP 7.5 or flip tile under WP 8.0+
                    var map = this.conf.tileMapping;
                    var properties = ["id", "title", "count", "backgroundImage", "backBackgroundImage", "backTitle", "backContent"];
                    if (info.version >= 8.0) {
                        sender = mpns.sendFlipTile;
                        properties.push(...Array.from(["smallBackgroundImage", "wideBackgroundImage", "wideBackContent", "wideBackBackgroundImage"] || []));
                    } else {
                        sender = mpns.sendTile;
                    }
                    for (let property of Array.from(properties)) {
                        if (map[property]) {
                            try {
                                note[property] = payload.compileTemplate(map[property]);
                            } catch (error2) { e = error2; }
                        }
                    }
                    break;
                                // ignore this property

                case "raw":
                    sender = mpns.sendRaw;
                    if ((subOptions != null ? subOptions.ignore_message : undefined) !== true) {
                        let message, title;
                        if (title = payload.localizedTitle(info.lang)) {
                            note['title'] = title;
                        }
                        if (message = payload.localizedMessage(info.lang)) {
                            note['message'] = message;
                        }
                    }
                    for (let key in payload.data) { const value = payload.data[key]; note[key] = value; }
                    // The driver only accepts payload string in raw mode
                    note = { payload: JSON.stringify(payload.data) };
                    break;

                default:
                    if (this.logger != null) {
                        this.logger.error(`Unsupported MPNS notification type: ${this.conf.type}`);
                    }
            }

            if (sender) {
                try {
                    return sender(info.token, note, (error, result) => {
                        if (error) {
                            if (error.shouldDeleteChannel) {
                                if (this.logger != null) {
                                    this.logger.warn(`MPNS Automatic unregistration for subscriber ${subscriber.id}`);
                                }
                                return subscriber.delete();
                            } else {
                                return (this.logger != null ? this.logger.error(`MPNS Error: (${error.statusCode}) ${error.innerError}`) : undefined);
                            }
                        } else {
                            return (this.logger != null ? this.logger.debug(`MPNS result: ${JSON.stringify(result)}`) : undefined);
                        }
                    });
                } catch (error3) {
                    const error = error3;
                    return (this.logger != null ? this.logger.error(`MPNS Error: ${error}`) : undefined);
                }
            }
        });
    }
}
PushServiceMPNS.initClass();

exports.PushServiceMPNS = PushServiceMPNS;
