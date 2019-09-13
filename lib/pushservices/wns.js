const wns = require('wns');

class PushServiceWNS {
    static initClass() {
        this.prototype.tokenFormat = /^https?:\/\/[a-zA-Z0-9-.]+\.notify\.windows\.com\/\S{0,500}$/;
    }
    validateToken(token) {
        if (PushServiceWNS.prototype.tokenFormat.test(token)) {
            return token;
        }
    }

    constructor(conf, logger, tokenResolver) {
        // TODO: tileMapping configuration for WNS
        this.conf = conf;
        this.logger = logger;
        if (this.conf.type == null) { this.conf.type = "toast"; }
        if ((this.conf.type === "tile") && !this.conf.tileMapping) {
            throw new Error("Invalid WNS configuration: missing `tileMapping` for `tile` type");
        }
    }

    push(subscriber, subOptions, payload) {
        return subscriber.get(info => {
            let launch, sender;
            let note = {};
            switch (this.conf.type) {
                case "toast":
                    //TODO: this always sends "ToastText2" toast.
                    if ((subOptions != null ? subOptions.ignore_message : undefined) !== true) {
                        sender = wns.sendToastText02;
                        note.text1 = payload.localizedTitle(info.lang) || ''; // prevents exception
                        note.text2 = payload.localizedMessage(info.lang);
                        if (this.conf.launchTemplate && (info.version >= 7.5)) {
                            try {
                                launch = payload.compileTemplate(this.conf.launchTemplate);
                                if (this.logger != null) {
                                    this.logger.silly(`Launch: ${launch}`);
                                }
                            } catch (e) {
                                if (this.logger != null) {
                                    this.logger.error(`Cannot compile WNS param template: ${e}`);
                                }
                                return;
                            }
                        }
                    }
                    break;

                case "tile":
                    //TODO
                    if (this.logger != null) {
                        this.logger.error("Not implemented: tile notifications");
                    }
                    break;

                case "raw":
                    sender = wns.sendRaw;
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
                        this.logger.error(`Unsupported WNS notification type: ${this.conf.type}`);
                    }
            }

            if (sender) {
                try {
                    const options = { client_id: this.conf.client_id, client_secret: this.conf.client_secret };
                    if (launch != null) {
                        options["launch"] = launch;
                    }
                    if (this.logger != null) {
                        this.logger.silly(`WNS client URL: ${info.token}`);
                    }
                    return sender(info.token, note, options, (error, result) => {
                        if (error) {
                            if (error.shouldDeleteChannel) {
                                if (this.logger != null) {
                                    this.logger.warn(`WNS Automatic unregistration for subscriber ${subscriber.id}`);
                                }
                                return subscriber.delete();
                            }
                        } else {
                            return (this.logger != null ? this.logger.debug(`WNS result: ${JSON.stringify(result)}`) : undefined);
                        }
                    });
                } catch (error1) {
                    const error = error1;
                    return (this.logger != null ? this.logger.error(`WNS Error: ${error}`) : undefined);
                }
            }
        });
    }
}
PushServiceWNS.initClass();

exports.PushServiceWNS = PushServiceWNS;
