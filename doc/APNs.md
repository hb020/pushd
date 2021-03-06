### Token Format

A 64 long hexadecimal number.

### Sample Configurations

You have the choice between Certificate authentication or Token authentication. The latter is less maintenance, because it doesn't expire.

#### With Certificate authentication:

``` javascript
exports.apns = {
    enabled: yes,
    class: require('./lib/pushservices/apns').PushServiceAPNS,

    cert: 'path/to/apns-cert.pem',
    key: 'path/to/apns-key.pem',
    production: false, // set to true for production
    topic : 'your-app-bundle-id' // if set, this is sent in the notification.
}
```

Converting your APNs Certificate:

After requesting the certificate from Apple, export your private key as a .p12 file and download the .cer file from the iOS Provisioning Portal.

Now, in the directory containing cert.cer and key.p12 execute the following commands to generate your .pem files:

    $ openssl x509 -in cert.cer -inform DER -outform PEM -out cert.pem
    $ openssl pkcs12 -in key.p12 -out key.pem -nodes

If you are using a development certificate you may wish to name them differently to enable fast switching between development and production. The filenames are configurable within the module options, so feel free to name them something more appropriate.


#### With Token authentication:

``` javascript
exports.apns = {
    enabled: yes,
    class: require('./lib/pushservices/apns').PushServiceAPNS,

    token: {
        key: "path/to/APNsAuthKey_XXXXXXXXXX.p8", // XXXXXXXXXX is likely your key-id
        keyId: "key-id",
        teamId: "developer-team-id"
    },
    production: false, // set to true for production
    topic : 'your-app-bundle-id' // if set, this is sent in the notification.
}
```

Parameters are transmitted as-is to the [apn node module](https://github.com/argon/node-apn).

