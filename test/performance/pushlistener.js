const express = require('express');
const bodyParser = require('body-parser');

class TimeStatistics {
    constructor() {
        this.count = 0;
        this.sum = 0;
        this.min = Infinity;
        this.max = 0;
    }

    update(sample) {
        this.count += 1;
        this.sum += sample;
        this.min = Math.min(sample, this.min);
        return this.max = Math.max(sample, this.max);
    }

    toString() {
        const avg = this.sum/this.count;
        return `${this.count} messages received, avg: ${avg.toFixed(1)} ms (min: ${this.min.toFixed(1)}, max: ${this.max.toFixed(1)})`;
    }
}

const timesPerEvent = {};

const app = express();
app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));
app.use(bodyParser.json({ limit: '1mb' }));

app.post(/^\/log\/(\w+)$/, function(req, res) {
    // console.log('Received message');
    // console.log(req.body);

    const receivedTime = Date.now()/1000.0;

    if (((req.body.message != null ? req.body.message.default : undefined) == null)) {
        console.log('No default message!');
        res.sendStatus(400);
    }

    const body = JSON.parse(req.body.message.default);
    if (((body != null ? body.timestamp : undefined) == null)) {
        console.log('No timestamp in the body!');
        res.sendStatus(400);
    }

    const { event } = req.body;

    const sentTime = body.timestamp;
    const diff = (receivedTime-sentTime)*1000;
    if ((timesPerEvent[event] == null)) {
        timesPerEvent[event] = new TimeStatistics();
    }
    timesPerEvent[event].update(diff);

    console.log(`${event} ` + timesPerEvent[event].toString());

    return res.sendStatus(200);
});

const port = 5001;
console.log(`Listening on port ${port}`);
app.listen(port);
