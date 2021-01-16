const AWS = require('aws-sdk');

exports.handler = async (event, context, callback) => {
  const response = {
    status: "UP"
  };

  return { statusCode: 200, body: JSON.stringify(response) };
};
