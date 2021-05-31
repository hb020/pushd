const http = require('http');
const url = require('url');

class PushServiceHTTP {

	validateToken (token) {
		let info = url.parse(token)
		if (info && (info.protocol == 'http:' || info.protocol == 'https:'))
			return token
	}

	constructor (conf, logger, tokenResolver) {
		this.logger=logger;
	}

	push (subscriber, subOptions, payload) {

		return subscriber.get(info => {

			const options = url.parse(info.token);
			options.method = 'POST';
			options.headers ={'Content-Type':'application/json','Connection':'close'}
			const body = {
				'event':payload.event.name,
				'title': payload.title,
				'message':payload.msg,
				'data':payload.data
			}

			const req = http.request(options);
			req.on('error', (e)=>{});
			req.write(JSON.stringify(body));
			req.end();

		});

	}
}

exports.PushServiceHTTP = PushServiceHTTP;