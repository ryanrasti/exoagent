import { env } from 'cloudflare:workers'
import { tool } from 'exoagent'
import { Database } from 'exoagent/sql'
import { D1Dialect } from 'kysely-d1'

const db = new Database(new D1Dialect({ database: env.EXOAGENT_BOUNTY_DB }))

class Wallet extends db.Table('wallets').as('wallet') {
  id = this.column('id')
  accountId = this.column('account_id')
  name = this.column('name')
  privateKey = this.column('private_key')
  balance = this.column('balance')
  description = this.column('description')
}

class Account extends db.Table('accounts').as('account') {
  id = this.column('id')
  userId = this.column('user_id')
  accountName = this.column('account_name')
  balance = this.column('balance')
  accountType = this.column('account_type')

  @tool()
  wallet() {
    return Wallet.on(wallet => wallet.accountId['='](this.id)).from()
  }
}

export class User extends db.Table('users').as('user') {
  id = this.column('id')
  name = this.column('name')
  email = this.column('email')
  createdAt = this.column('created_at')

  @tool()
  accounts() {
    return Account.on(account => account.userId['='](this.id)).from()
  }
}
