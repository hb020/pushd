exports.server = {
    redis_port: 6379,
    redis_host: 'localhost',
    // redis_socket: '/var/run/redis/redis.sock'
    // redis_auth: 'password'
    // redis_db_number: 2
    // listen_ip: '10.0.1.2'
    tcp_port: 80,
    udp_port: 80,
    access_log: true,
    acl: {
        // restrict publish access to private networks
        publish: ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']
    }
};
//    auth:
//        # require HTTP basic authentication, username is 'admin' and
//        # password is 'password'
//        #
//        # HTTP basic authentication overrides IP-based authentication
//        # if both acl and auth are defined.
//        admin:
//            password: 'password'
//            realms: ['register', 'publish']

exports.apns = {
    enabled: true,
    class: require('./lib/pushservices/apns').PushServiceAPNS,
    // When using certificate based authentication:
    // Convert cert.cer and key.p12 using:
    // $ openssl x509 -in cert.cer -inform DER -outform PEM -out apns-cert.pem
    // $ openssl pkcs12 -in key.p12 -out apns-key.pem -nodes
    // cert: 'path/to/apns-cert.pem',
    // key: 'path/to/apns-key.pem',
    
    // When using token-based authentication (a key) (which is less maintenance than certificates):
    token: {
        key: "path/to/APNsAuthKey_XXXXXXXXXX.p8", // XXXXXXXXXX is likely your key-id
        keyId: "key-id",
        teamId: "developer-team-id"
    },
    production: false, // set to true for production
    topic : 'your-app-bundle-id', // if set, this is sent in the notification.
    // Uncomment to set the default value for parameter.
    // This setting not overrides the value for the parameter that is set in the payload fot event request.
    // category: 'show'
    // Selects data keys which are allowed to be sent with the notification
    // Keep in mind that APNS limits notification payload size to 256 bytes
    payloadFilter: ['messageFrom']
};

exports.gcm = {
    enabled: true,
    class: require('./lib/pushservices/gcm').PushServiceGCM,
    key: 'GCM API KEY HERE'
};
    //options:
       //proxy: 'PROXY SERVER HERE'

// Transports: Console, File, Http
//
// Common options:
// level:
//   error: log errors only
//   warn: log also warnings
//   info: log status messages
//   verbose: log event and subscriber creation and deletion
//   silly: log submitted message content
//
// See https://github.com/flatiron/winston#working-with-transports for
// other transport-specific options.
exports.logging = [{
        transport: 'Console',
        options: {
            level: 'info'
        }
    }
    ];
