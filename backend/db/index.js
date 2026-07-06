const { isMongoDb } = require('../config/index');
const mysqlStore = require('./mysql-store');
const mongoStore = require('./mongo-store');

const store = isMongoDb() ? mongoStore : mysqlStore;

module.exports = {
  ...store,
  isMongoDb: isMongoDb()
};
