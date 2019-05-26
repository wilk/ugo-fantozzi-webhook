const { WebhookClient } = require('dialogflow-fulfillment')
const express = require('express')
const bodyParser = require('body-parser')
const got = require('got')
const dotenv = require('dotenv')
const dayjs = require('dayjs')

const app = express()
const client = got.extend({
  headers: {
    'content-type': 'application/json'
  }
})

dotenv.config()

const port = 3000

app.use(bodyParser.json())

const BUXFER_USERNAME = process.env.BUXFER_USERNAME
const BUXFER_PASSWORD = process.env.BUXFER_PASSWORD
const BUXFER_API_URL = process.env.BUXFER_API_URL
const BUXFER_ACCOUNT_ID = process.env.BUXFER_ACCOUNT_ID

let loginToken = ''

const transactionTags = {
  'ristoranti-bar': {
    tag: 'Ristoranti Bar',
    periodTag: 'Uscite / Mensili',
    type: 'expense'
  }
}

const login = async () => {
  try {
    console.log('LOGIN')
    const body = JSON.stringify({
      userid: BUXFER_USERNAME,
      password: BUXFER_PASSWORD
    })
    const res = await client.post(`${BUXFER_API_URL}/login`, { body })
    const resBody = JSON.parse(res.body)
    if (resBody.response.status !== 'OK' || resBody.response.token.length === 0) return new Error('login failed')

    loginToken = resBody.response.token
    return undefined
  } catch (err) {
    return err
  }
}

const addTransaction = async ({ date, description, amount, type, tag, periodTag }) => {
  try {
    if (!loginToken) {
      const err = await login()
      if (err) return err
    }

    const body = JSON.stringify({
      date,
      description,
      amount,
      type,
      token: loginToken,
      tags: [tag, periodTag].join(','),
      accountId: BUXFER_ACCOUNT_ID
    })
    const res = await client.post(`${BUXFER_API_URL}/add_transaction`, { body })
    const resBody = JSON.parse(res.body)

    if (resBody.response.error) {
      if (resBody.response.error.message === 'Access denied. Please login first.') {
        console.log('token expired, new retry with login first')
        loginToken = ''
        return await addTransaction(transaction)
      }
      return new Error(resBody.response.error.message)
    }

    return undefined
  } catch (err) {
    return err
  }
}

const onInsertTransaction = async agent => {
  const { number, date, ...parameters } = agent.parameters
  if (!number) return agent.add(`Vostra eccellenza, mancherebbe l'importo`)

  const transaction = Object.entries(parameters)
    .flatMap(param => param[1] ? { description: param[1], ...transactionTags[param[0]], amount: number } : undefined)
    .filter(param => param)
    .shift()

  transaction.date = date ? dayjs(date) : dayjs()
  transaction.date = transaction.date.format('YYYY-MM-DD')

  let reply
  if (!transaction.tag || !transaction.periodTag) {
    console.error(new Error('missing tag and/or error tag'))
    console.log(transaction)
    reply = 'non riesco a capire il tag o il period tag di riferimento! vuoi registrare una nuova transazione?'
  } else {
    const error = await addTransaction(transaction)
    if (error) {
      console.error(error)
      reply = 'qualcosa è andato storto! vuoi registrare una nuova transazione?'
    } else reply = 'ho registrato la transazione, vostra eccellenza! vuole registrarne una nuova?'
  }

  agent.add(reply)
}

const dialogflowAgentProcessor = (request, response) => {
  const agent = new WebhookClient({ request, response });
  const intentMap = new Map();
  intentMap.set('Insert transaction', onInsertTransaction);
  agent.handleRequest(intentMap);
}

app.post('/', (req, res) => {
  dialogflowAgentProcessor(req, res)
});

app.listen(port, () => console.log(`Listening on port ${port}`))
