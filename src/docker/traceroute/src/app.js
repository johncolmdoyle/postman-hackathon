"use strict";
const traceroute = require('traceroute');
const AWS = require('aws-sdk');
const ipRangeCheck = require("ip-range-check");
const fs = require('fs');
const fetch = require('node-fetch');

AWS.config.update({region: process.env.AWS_REGION});

const db = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'});

const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const SORT_KEY = process.env.SORT_KEY || '';
const GEOIP_TABLE_NAME = process.env.GEOIP_TABLE_NAME || '';
const GEOIP_PRIMARY_KEY = process.env.GEOIP_PRIMARY_KEY || '';

const RESERVED_RESPONSE = `Error: You're using AWS reserved keywords as attributes`,
  DYNAMODB_EXECUTION_ERROR = `Error: Execution update, caused a Dynamodb error, please take a look at your CloudWatch Logs.`;

function trace(domain) {
  return new Promise((resolve) => {
    traceroute.trace(domain, function (err,hops) {
      if (!err) resolve(hops);
    });
  });
} 

function retrieveIPGeoInformation(ip){
    return new Promise(function(resolve, reject){
        const url = 'https://ipapi.co/' + ip.replace(/['"]+/g, '') + '/json';

        let settings = { method: "Get" };

        fetch(url, settings)
          .then(res => res.json())
          .then((json) => {
            resolve(json);
          });

    });
}

function getAWSDetails(ipAddress) {
  return new Promise((resolve) => {
    fs.readFile('ip-ranges.json', (err, data) => {
      if (err) throw err;
      let cidrData = JSON.parse(data);

      cidrData.prefixes.forEach(function(prefix) {
        if (ipRangeCheck(ipAddress, prefix.ip_prefix)) {
          resolve(prefix);
        }
      });

      resolve();
    });
  });
}

exports.handler = async (event, context) => {
  let item = {};

  const TTL_DELTA = 60 * 60 * 24 * 2; // Keep records for 2 days

  for (const record of event.Records) {
    item[PRIMARY_KEY] = record.dynamodb.NewImage.initId.S;
    item[SORT_KEY] = 'traceroute';

    item['lambdaRequestId'] = context.awsRequestId;
    item['regionFunction'] = process.env.AWS_REGION;

    item['createdAt'] = (Math.floor(+new Date() / 1000)).toString();
    item['ttl'] = (Math.floor(+new Date() / 1000) + TTL_DELTA).toString();

    let url = new URL(record.dynamodb.NewImage.apiUrl.S);

    try{
        const response = trace(url.hostname);
        const dataResponse = await Promise.all([response]);

        let hopData = [];

        let hopCount = 1;

        let noICMPCount = 0;

        for (const index in dataResponse[0]) {
          const value = dataResponse[0][index];

          if (!value) {
            noICMPCount++;
            if (noICMPCount > 4) {
              break;
            }
          } else {
            noICMPCount = 0;
            let hopObj = {};

            hopObj['hop'] = hopCount;
            hopObj['ip'] = Object.keys(value)[0];

            // Lets get the Lat/Long of the IP
            const keyData = {};
            keyData[GEOIP_PRIMARY_KEY] = hopObj['ip'];

            const ipParams = {
              TableName: GEOIP_TABLE_NAME,
              Key: keyData
            };

            try {
              let dataSet = await db.get(ipParams).promise();

              const dynamoDbData = AWS.DynamoDB.Converter.unmarshall(dataSet);

              if(dynamoDbData.hasOwnProperty("Item") && dynamoDbData["Item"].hasOwnProperty("ipapi")) {
                if(dynamoDbData["Item"]["ipapi"].hasOwnProperty("latitude")) {
                  hopObj['latitude'] = dynamoDbData["Item"]["ipapi"]["latitude"]["S"];
                }
                if(dynamoDbData["Item"]["ipapi"].hasOwnProperty("longitude")) {
                  hopObj['longitude'] = dynamoDbData["Item"]["ipapi"]["longitude"]["S"];
                }
              } else {
                const geoIpRequest = retrieveIPGeoInformation(hopObj['ip']);
                const geoIpResponse = await Promise.all([geoIpRequest]);

                if (geoIpResponse[0].hasOwnProperty("latitude") && geoIpResponse[0].hasOwnProperty("longitude")) {
                  hopObj['latitude'] = geoIpResponse[0]['latitude'];
                  hopObj['longitude'] = geoIpResponse[0]['longitude'];
                }

                // save to dynamodb
                let ipData =  {};
                ipData["ipapi"] = geoIpResponse[0];
                ipData[GEOIP_PRIMARY_KEY] = hopObj['ip'];
                
                const geoParams = {
                  TableName: GEOIP_TABLE_NAME,
                  Item: ipData
                };

                console.log(JSON.stringify(geoParams));

                try {
                  await db.put(geoParams).promise();
                } catch (dbError) {
                  const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
                  DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
                  console.log(errorResponse);
                }
              }
            } catch (dbError) {
              console.log(JSON.stringify(dbError))
            }

            hopObj['rrt'] = Object.keys(value).map(key => value[key][0])[0];

            const awsData = getAWSDetails(Object.keys(value)[0]);
            const awsDataResponse = await Promise.all([awsData]);
            hopObj['aws'] = awsDataResponse[0];

            hopData.push(hopObj);
            hopCount++;
          }
        }

        item['traceroute'] = hopData;
    }catch(err){
        console.error(err);
    }

    const params = {
      TableName: TABLE_NAME,
      Item: item
    };

    try {
      await db.put(params).promise();
    } catch (dbError) {
      const errorResponse = dbError.code === 'ValidationException' && dbError.message.includes('reserved keyword') ?
      DYNAMODB_EXECUTION_ERROR : RESERVED_RESPONSE;
      console.log(errorResponse);
    }
  }
}
