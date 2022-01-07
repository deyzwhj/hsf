import { getAccount, getCurrentUsername, saveSrpInfo, updateAccount } from './perm'
import { verifyPassword } from './crypt'
import { CFG_ALLOW_CLEAR_TEXT_LOGIN, getConfig } from './config'
import { ApiHandler } from './apis'
import { SRPParameters, SRPRoutines, SRPServerSession, SRPServerSessionStep1 } from 'tssrp6a'
import { SESSION_DURATION } from './index'

const srp6aNimbusRoutines = new SRPRoutines(new SRPParameters())
const srpSession = new SRPServerSession(srp6aNimbusRoutines)
const ongoingLogins:Record<string,SRPServerSessionStep1> = {}

function makeExp() {
    return { exp: new Date(Date.now() + SESSION_DURATION) }
}

export const login: ApiHandler = async ({ user, password }, ctx) => {
    if (!user)
        return ctx.status = 400
    if (!password)
        return ctx.status = 400
    const acc = getAccount(user)
    if (!acc)
        return ctx.status = 401
    if (!acc.hashedPassword)
        return ctx.status = 406
    if (!await verifyPassword(acc.hashedPassword, password))
        return ctx.status = 401
    if (ctx.session)
        ctx.session.user = user
    return makeExp()
}

export const loginSrp1: ApiHandler = async ({ user }, ctx) => {
    const account = getAccount(user)
    if (!ctx.session)
        return ctx.throw(500)
    if (!account) // TODO simulate fake account to prevent knowing valid usernames
        return ctx.status = 401
    if (!account.srp)
        return ctx.status = 406 // unacceptable

    const [salt, verifier] = account.srp.split('|')
    const step1 = await srpSession.step1(account.user, BigInt(salt), BigInt(verifier))
    const sid = Math.random()
    ongoingLogins[sid] = step1
    setTimeout(()=> delete ongoingLogins[sid], 60_000)

    ctx.session.login = { user, sid }
    return { salt, pubKey: String(step1.B) } // cast to string cause bigint can't be jsonized
}

export const loginSrp2: ApiHandler = async ({ pubKey, proof }, ctx) => {
    if (!ctx.session)
        return ctx.throw(500)
    const { user, sid } = ctx.session.login
    const step1 = ongoingLogins[sid]
    try {
        const M2 = await step1.step2(BigInt(pubKey), BigInt(proof))
        ctx.session.user = user
        return { proof: String(M2), ...makeExp() }
    }
    catch(e) {
        ctx.body = String(e)
        ctx.status = 401
    }
}

export const logout: ApiHandler = async ({}, ctx) => {
    if (ctx.session)
        ctx.session.user = undefined
    ctx.status = 200
    return true
}

export const refresh_session: ApiHandler = async ({}, ctx) => {
    return { user: ctx.session?.user, ...makeExp() }
}

export const change_password: ApiHandler = async ({ newPassword }, ctx) => {
    if (!newPassword) // clear text version
        return Error('missing parameters')
    await updateAccount(await getCurrentUsername(ctx), account => {
        account.password = newPassword
    })
    return true
}

export const change_srp: ApiHandler = async ({ salt, verifier }, ctx) => {
    if (getConfig(CFG_ALLOW_CLEAR_TEXT_LOGIN))
        return ctx.status = 406
    if (!salt || !verifier)
        return Error('missing parameters')
    await updateAccount(await getCurrentUsername(ctx), account => {
        saveSrpInfo(account, salt, verifier)
        delete account.hashedPassword // remove leftovers
    })
    return true
}

