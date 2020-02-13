let serial = 0;

class Payload {
    static initClass() {
        this.prototype.locale_format = /^[a-z]{2}_[A-Z]{2}$/;
    }

    constructor(data) {
        let key;
        if (typeof data !== 'object') { throw new Error('Invalid payload'); }

        this.id = serial++;
        this.compiled = false;
        this.title = {};
        this.msg = {};
        this.data = {};
        this.var = {};
        this.incrementBadge = true;

        // Read fields
        for (key of Object.keys(data || {})) {
            var prefix, ref, subkey;
            const value = data[key];
            if ((typeof key !== 'string') || (key.length === 0)) {
                throw new Error("Invalid field (empty)");
            }
            if (typeof value !== 'string') {
                throw new Error(`Invalid value for \`${key}'`);
            }

            switch (key) {
                case 'title': this.title.default = value; break;
                case 'msg': this.msg.default = value; break;
                case 'image': this.image = value; break;
                case 'sound': this.sound = value; break;
                case 'incrementBadge': this.incrementBadge = value !== 'false'; break;
                case 'badge': this.badge = value; break;
                case 'category': this.category = value; break;
                case 'contentAvailable': this.contentAvailable = value !== 'false'; break;
                default:
                    if (([prefix, subkey] = Array.from(ref = key.split('.', 2)), ref).length === 2) {
                        this[prefix][subkey] = value;
                    } else {
                        throw new Error(`Invalid field: ${key}`);
                    }
            }
        }

        // Detect empty payload
        let sum = 0;
        for (var type of ['title', 'msg', 'data']) { sum += ((() => {
            const result = [];
            for (key of Object.keys(this[type] || {})) {
                result.push(key);
            }
            return result;
        })()).length; }
        if (sum === 0) { throw new Error('Empty payload'); }
    }

    localizedTitle(lang) {
        return this.localized('title', lang);
    }

    localizedMessage(lang) {
        return this.localized('msg', lang);
    }

    localized(type, lang) {
        if (!this.compiled) { this.compile(); }
        if (this[type][lang] != null) {
            return this[type][lang];
        // Try with lang only in case of full locale code (en_CA)
        } else if (Payload.prototype.locale_format.test(lang) && (this[type][lang.slice(0, 2)] != null)) {
            return this[type][lang.slice(0, 2)];
        } else if (this[type].default) {
            return this[type].default;
        }
    }

    compile() {
        // Compile title and msg templates
        for (let type of ['title', 'msg']) { for (let lang of Object.keys(this[type] || {})) { const msg = this[type][lang]; this[type][lang] = this.compileTemplate(msg); } }
        return this.compiled = true;
    }

    compileTemplate(tmpl) {
        return tmpl.replace(/\$\{(.*?)\}/g, (match, keyPath) => {
            return this.variable(keyPath);
        });
    }

    // Extracts variable from payload. The keyPath can be `var.somekey` or `data.somekey`
    variable(keyPath) {
        if (keyPath === 'event.name') {
            // Special case
            if (this.event != null ? this.event.name : undefined) {
                return (this.event != null ? this.event.name : undefined);
            } else {
                throw new Error(`The \${${keyPath}} does not exist`);
            }
        }

        const [prefix, key] = Array.from(keyPath.split('.', 2));
        if (!['var', 'data'].includes(prefix)) {
            throw new Error(`Invalid variable type for \${${keyPath}}`);
        }
        if ((this[prefix][key] == null)) {
            throw new Error(`The \${${keyPath}} does not exist`);
        }
        return this[prefix][key];
    }
}
Payload.initClass();


exports.Payload = Payload;
