class PushServices {
    static initClass() {
        this.prototype.services = {};
    }

    addService(protocol, service) {
        return this.services[protocol] = service;
    }

    getService(protocol) {
        return this.services[protocol];
    }

    push(subscriber, subOptions, payload, cb) {
        return subscriber.get(info => {
            if (info) { if (this.services[info.proto] != null) {
                this.services[info.proto].push(subscriber, subOptions, payload);
            } }
            if (cb) { return cb(); }
        });
    }
}
PushServices.initClass();

exports.PushServices = PushServices;
