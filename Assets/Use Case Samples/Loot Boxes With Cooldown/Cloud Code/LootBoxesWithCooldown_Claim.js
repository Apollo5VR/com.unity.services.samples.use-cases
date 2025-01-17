// This file is an inactive copy of what is published on the Cloud Code server for this sample, so changes made to
// this file will not have any effect locally. Changes to Cloud Code scripts are normally done directly in the 
// Unity Dashboard.

const cooldownSeconds = 60;
const epochTimeToSeconds = 1000;
const rateLimitError = 429;
const validationError = 400;

const _ = require("lodash-4.17");
const { CurrenciesApi } = require("@unity-services/economy-2.0");
const { InventoryApi } = require("@unity-services/economy-2.0");
const { DataApi } = require("@unity-services/cloud-save-1.0");

// Entry point for the Cloud Code script
module.exports = async ({ params, context, logger }) => {

  const { projectId, playerId, accessToken} = context;
  const cloudSaveApi = new DataApi({ accessToken });

  try
  {
    var epochTime = Math.floor(new Date().valueOf() / epochTimeToSeconds);

    // Check if the cooldown has expired or was never set (the player hasn't yet ever claimed a Loot Box)
    const getTimeResponse = await cloudSaveApi.getItems(projectId, playerId, [ "GRANT_TIMED_REWARD_TIME" ] );
    if (getTimeResponse.data.results &&
        getTimeResponse.data.results.length > 0 &&
        getTimeResponse.data.results[0] &&
        getTimeResponse.data.results[0].value)
    {
      var grantEpochTime = getTimeResponse.data.results[0].value;
      var cooldown = cooldownSeconds - (epochTime - grantEpochTime);
      
      // If cooldown timer has not expired (using 1 for slight tolerance in case the Claim button is pressed early)
      if (cooldown > 1)
      {
        logger.error("The player tried to claim a Loot Box before the cooldown timer expired.");
        throw new CloudCodeCustomError("The player tried to claim a Loot Box before the cooldown timer expired.");      
      }
    }  

    // Select a random reward to grant
    const currencyApi = new CurrenciesApi({ accessToken }); 
    const inventoryApi = new InventoryApi({ accessToken });
    let currencyIds = ["COIN", "GEM", "PEARL", "STAR"];
    let inventoryItemIds = ["SWORD", "SHIELD"];

    let currencyId1 = pickRandomCurrencyId(currencyIds, null);
    let currencyQuantity1 = pickRandomCurrencyQuantity(currencyId1);
    let currencyId2 = pickRandomCurrencyId(currencyIds, currencyId1);
    let currencyQuantity2 = pickRandomCurrencyQuantity(currencyId2);
    let inventoryItemId = pickRandomInventoryItemId(inventoryItemIds);
    let inventoryItemQuantity = pickRandomInventoryItemQuantity(inventoryItemId);

    // Grant all rewards and update the cooldown timer
    await Promise.all([
      cloudSaveApi.setItem(projectId, playerId, { key: "GRANT_TIMED_REWARD_TIME", value: epochTime } ),
      grantCurrency(currencyApi, projectId, playerId, currencyId1, currencyQuantity1),
      grantCurrency(currencyApi, projectId, playerId, currencyId2, currencyQuantity2),
      grantInventoryItem(inventoryApi, projectId, playerId, inventoryItemId, inventoryItemQuantity)
      ]);
    
    return { 
      currencyId: [currencyId1, currencyId2], 
      currencyQuantity: [currencyQuantity1, currencyQuantity2],
      inventoryItemId: [inventoryItemId], 
      inventoryItemQuantity: [inventoryItemQuantity] 
    };
  }
  catch (error)
  {
    transformAndThrowCaughtError(error);
  }
};

// Pick a random currency reward from the list
function pickRandomCurrencyId(currencyIds, invalidId)
{
  let i = _.random(currencyIds.length - 1);
  
  if (currencyIds[i] === invalidId)
  {
    i++;
    if (i >= currencyIds.length)
    {
      i = 0;
    }
  }
  return currencyIds[i];
}

// Pick a random quantity for the specified currency (uses 1-5 for sample)
function pickRandomCurrencyQuantity(currencyId)
{
  return _.random(1, 5);
}

// Grant the specified currency reward using the Economy service
async function grantCurrency(currencyApi, projectId, playerId, currencyId, amount)
{
  await currencyApi.incrementPlayerCurrencyBalance(projectId, playerId, currencyId, { currencyId, amount });
}

// Pick a random inventory item from the list
function pickRandomInventoryItemId(inventoryItemIds)
{
  return inventoryItemIds[_.random(inventoryItemIds.length - 1)];
}

// Pick a quantity of inventory items to grant (75% chance to grant 1, but rarely to grant 2)
function pickRandomInventoryItemQuantity(inventoryItemId)
{
  if (_.random(1, 100) >= 75)
  {
    return 2;
  }
  return 1;
}

// Grant the specified inventory item the specified number of times
async function grantInventoryItem(inventoryApi, projectId, playerId, inventoryItemId, amount)
{
  for (let i = 0; i < amount; i++)
  {
    await inventoryApi.addInventoryItem(projectId, playerId, { inventoryItemId: inventoryItemId });
  }
}

// Some form of this function appears in all Cloud Code scripts.
// Its purpose is to parse the errors thrown from the script into a standard exception object which can be stringified.
function transformAndThrowCaughtError(error) {
  let result = {
    status: 0,
    title: "",
    message: "",
    retryAfter: null,
    additionalDetails: ""
  };

  if (error.response)
  {
    result.status = error.response.data.status ? error.response.data.status : 0;
    result.title = error.response.data.title ? error.response.data.title : "Unknown Error";
    result.message = error.response.data.detail ? error.response.data.detail : error.response.data;
    if (error.response.status === rateLimitError)
    {
      result.retryAfter = error.response.headers['retry-after'];
    }
    else if (error.response.status === validationError)
    {
      let arr = [];
      _.forEach(error.response.data.errors, error => {
        arr = _.concat(arr, error.messages);
      });
      result.additionalDetails = arr;
    }
  }
  else
  {
    if (error instanceof CloudCodeCustomError)
    {
      result.status = error.status;
    }
    result.title = error.name;
    result.message = error.message;
  }

  throw new Error(JSON.stringify(result));
}

class CloudCodeCustomError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudCodeCustomError";
    this.status = 1;
  }
}
