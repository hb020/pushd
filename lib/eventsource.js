policyFile = '<?xml version="1.0"?>' +
			 '<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">' +
			 '<cross-domain-policy>' +
			 '<site-control permitted-cross-domain-policies="master-only"/>' +
			 '<allow-access-from domain="*" secure="false"/>' +
			 '<allow-http-request-headers-from domain="*" headers="Accept"/>' +
			 '</cross-domain-policy>'

 exports.setup = function(app, authorize, eventPublisher) {
	//app.post('/subscribers', authorize('register'), function(req, res) {
	app.get('/crossdomain.xml', function(req, res){
		 res.type('application/xml');
		 res.send(policyFile);
	})

	app.options('/subscribe', function(req, res){
		res.set('Content-Type', 'text/event-stream');
		res.set('Access-Control-Allow-Origin', req.get('Origin') || '*')
		res.set('Access-Control-Allow-Methods', 'GET')
		res.set('Access-Control-Max-Age', '86400')
		res.set('Access-Control-Allow-Headers', 'Authorization')
		res.set('Access-Control-Allow-Credentials', true)
		res.end();
	});

	app.get('/subscribe', authorize('listen'), function(req, res){
		if (!req.accepts('text/event-stream')) {
			return res.sendStatus(406);
		}

		if (typeof req.query.events != 'string') {
			return res.sendStatus(400);
		}

		const eventNames = req.query.events.split(' ')

		req.socket.setTimeout(0x7FFFFFFF);
		req.socket.setNoDelay(true);
		res.set('Content-Type', 'text/event-stream')
		res.set('Cache-Control', 'no-cache')
		res.set('Access-Control-Allow-Origin', req.get('Origin') || '*')
		res.set('Access-Control-Allow-Credentials', true)
		res.set('Connection', 'close')
		res.write('\n')

		if (req.get('User-Agent') && req.get('User-Agent').indexOf('MSIE') != -1) {
			// Work around MSIE bug preventing Progress handler from being thrown before first 2048 bytes
			// See http://forums.adobe.com/message/478731
			res.write( new Array(2048).join('\n'))
		}

		const sendEvent = function(event, payload) {
			data = {event:event.name,
					title: payload.title,
					message: payload.msg,
					data: payload.data}
			res.write("data: " + JSON.stringify(data) + "\n\n")
		}

		const antiIdleInterval = setInterval(function(){res.write("\n")}, 10000);

		res.socket.on('close',function(){
			clearInterval(antiIdleInterval)
			for (const i in eventNames) {
				eventPublisher.removeListener(eventNames[i], sendEvent)
			}
		});

		for (const i in eventNames) {
			eventPublisher.addListener(eventNames[i], sendEvent);
		}

	});
 }