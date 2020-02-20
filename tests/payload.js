const should = require('should');
const { Payload } = require('../lib/payload');

describe('Payload', function() {
    describe('when empty', () => {
        return it('should throw an error', () => {
            (() => new Payload({})).should.throw('Empty payload');
            (() => new Payload({'var.test': 'value'})).should.throw('Empty payload');
            (() => new Payload({sound: 'value'})).should.throw('Empty payload');
            return (() => new Payload({category: 'value'})).should.throw('Empty payload');
        });
    });

    describe('with invalid key', () => {
        return it('should throw an error', () => {
            return (() => new Payload({foo: 'bar'})).should.throw('Invalid field: foo');
        });
    });

    describe('with simple message', () => {
        const payload = new Payload({title: 'my title', msg: 'my message'});

        it('should fallback to default title', () => {
            return payload.localizedTitle('fr').should.equal('my title');
        });
        return it('should fallback to default message', () => {
            return payload.localizedMessage('fr').should.equal('my message');
        });
    });

    describe('localization', () => {
        const payload = new Payload({
            title: 'my title',
            'title.fr': 'mon titre',
            'title.en_GB': 'my british title',
            msg: 'my message',
            'msg.fr': 'mon message',
            'msg.fr_CA': 'mon message canadien'
        });

        it('should fallback to default if no localization requested', () => {
            return payload.localizedTitle().should.equal('my title');
        });
        it('should localize title in french for "fr" localization', () => {
            return payload.localizedTitle('fr').should.equal('mon titre');
        });
        it('should localize message in french for "fr" localization', () => {
            return payload.localizedMessage('fr').should.equal('mon message');
        });
        it('should use language if no locale found', () => {
            return payload.localizedTitle('fr_BE').should.equal('mon titre');
        });
        return it('should use full locale variant if any', () => {
            return payload.localizedMessage('fr_CA').should.equal('mon message canadien');
        });
    });

    return describe('template', () => {
        it('should throw an error if using an undefined variable', () => {
            const payload = new Payload({title: 'hello ${var.name}'});
            return ((() => payload.compile())).should.throw('The ${var.name} does not exist');
        });

        it('should throw an error if using an undefined variable in localized title', () => {
            const payload = new Payload({'title.fr': 'hello ${var.name}'});
            return ((() => payload.compile())).should.throw('The ${var.name} does not exist');
        });

        it('should throw an error with invalid variable name', () => {
            const payload = new Payload({title: 'hello ${name}', 'var.name': 'world'});
            return ((() => payload.compile())).should.throw('Invalid variable type for ${name}');
        });

        it('should resolve (var) variable correctly', () => {
            const payload = new Payload({
                title: 'hello ${var.name}',
                'var.name': 'world'
            });
            return payload.localizedTitle().should.equal('hello world');
        });

        return it('should resolve (data) variable correctly', () => {
            const payload = new Payload({
                title: 'hello ${data.name}',
                'data.name': 'world'
            });
            return payload.localizedTitle().should.equal('hello world');
        });
    });
});
