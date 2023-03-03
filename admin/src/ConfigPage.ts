// This file is part of HFS - Copyright 2021-2023, Massimo Melina <a@rejetto.com> - License https://www.gnu.org/licenses/gpl-3.0.txt

import { Box, Button, FormHelperText, Link } from '@mui/material';
import { createElement as h, useEffect, useRef } from 'react';
import { apiCall, useApi, useApiEx } from './api'
import { state, useSnapState } from './state'
import { Info, Refresh, Warning } from '@mui/icons-material'
import { Dict, modifiedSx, with_ } from './misc'
import { subscribeKey } from 'valtio/utils'
import {
    Form,
    BoolField,
    NumberField,
    SelectField,
    StringStringField,
    FieldProps,
    Field,
    StringField
} from '@hfs/mui-grid-form';
import FileField from './FileField'
import { alertDialog, closeDialog, confirmDialog, formDialog, newDialog, toast, waitDialog } from './dialog'
import { proxyWarning } from './HomePage'
import _ from 'lodash';
import { proxy, useSnapshot } from 'valtio'

let loaded: Dict | undefined
let exposedReloadStatus: undefined | (() => void)
const pageState = proxy({
    changes: {} as Dict
})

subscribeKey(state, 'config', recalculateChanges)

export const logLabels = {
    log: "Access log file",
    error_log: "Access error log file"
}

export default function ConfigPage() {
    const { data, reload: reloadConfig, element } = useApiEx('get_config', { omit: ['vfs'] })
    let snap = useSnapState()
    const { changes } = useSnapshot(pageState)
    const statusApi  = useApiEx(data && 'get_status')
    const status = statusApi.data
    const reloadStatus = exposedReloadStatus = statusApi.reload
    useEffect(() => void(reloadStatus()), [data]) //eslint-disable-line
    useEffect(() => () => exposedReloadStatus = undefined, []) // clear on unmount

    const admins = useApi('get_admins')[0]?.list

    if (element)
        return element
    if (statusApi.error)
        return statusApi.element
    const values = (loaded !== data) ? (state.config = loaded = data) : snap.config
    const maxSpeedDefaults = {
        comp: NumberField,
        min: 1,
        placeholder: "no limit",
        md: 3,
    }
    return h(Form, {
        sx: { maxWidth: '60em' },
        values,
        set(v, k) {
            state.config[k] = v
        },
        stickyBar: true,
        onError: alertDialog,
        save: {
            onClick: save,
            sx: modifiedSx( Object.keys(changes).length>0),
        },
        barSx: { gap: 2 },
        addToBar: [h(Button, {
            onClick() {
                reloadConfig()
                reloadStatus()
            },
            startIcon: h(Refresh),
        }, "Reload")],
        defaults() {
            return { sm: 6 }
        },
        fields: [
            { k: 'port', comp: ServerPort, md: 3, label:"HTTP port", status: status?.http||true, suggestedPort: 80 },
            { k: 'https_port', comp: ServerPort, md: 3, label: "HTTPS port", status: status?.https||true, suggestedPort: 443,
                onChange(v: number) {
                    if (v >= 0 && values.https_port < 0 && !values.cert)
                        suggestMakingCert()
                    return v
                }
            },
            { k: 'max_kbps',        ...maxSpeedDefaults, label: "Limit output KB/s", helperText: "Doesn't apply to localhost" },
            { k: 'max_kbps_per_ip', ...maxSpeedDefaults, label: "Limit output KB/s per-ip" },
            values.https_port >= 0 && { k: 'cert', comp: FileField, label: "HTTPS certificate file",
                ...with_(status?.https.error, e => isCertError(e) ? { 
                    error: true, 
                    helperText: [e, ' - ', h(Link, { key: 'fix', sx: { cursor: 'pointer' }, onClick: makeCertAndSave }, "make one")] 
                } : null)
            },
            values.https_port >= 0 && { k: 'private_key', comp: FileField, label: "HTTPS private key file",
                ...with_(status?.https.error, e => isKeyError(e) ? { error: true, helperText: e } : null)
            },
            { k: 'open_browser_at_start', comp: BoolField, label: "Open Admin-panel at start", helperText: "Browser is automatically launched with HFS" },
            { k: 'localhost_admin', comp: BoolField, label: "Admin access for localhost connections",
                getError: x => !x && admins?.length===0 && "First create at least one admin account",
                helperText: "To access Admin without entering credentials"
            },
            { k: 'title', helperText: "You can see this in the tab of your browser" },
            { k: 'favicon', comp: FileField, placeholder: "None", fileMask: '*.png|*.ico|*.jpg|*.jpeg|*.gif|*.svg',
                helperText: "The icon associated to your website" },
            { k: 'log', label: logLabels.log, md: 3, helperText: "Requests are logged here" },
            { k: 'error_log', label: logLabels.error_log, md: 3, placeholder: "errors go to main log", helperText: "If you want errors in a different log" },
            { k: 'log_rotation', comp: SelectField, options: [{ value:'', label:"disabled" }, 'daily', 'weekly', 'monthly' ],
                helperText: "To avoid an endlessly-growing single log file, you can opt for rotation"
            },
            { k: 'proxies', comp: NumberField, min: 0, max: 9, sm: 6, label: "How many HTTP proxies between this server and users?",
                error: proxyWarning(values, status),
                helperText: "Wrong number will prevent detection of users' IP address"
            },
            { k: 'allowed_referer', placeholder: "any", label: "Links from other websites", comp: AllowedReferer },
            { k: 'dont_overwrite_uploading', comp: BoolField, label: "Don't overwrite uploading",
                helperText: "Files will be numbered to avoid overwriting" },
            { k: 'delete_unfinished_uploads_after', comp: NumberField, md: 3, min : 0, unit: "seconds", placeholder: "Never",
                helperText: "Leave empty to never delete" },
            { k: 'min_available_mb', comp: NumberField, md: 3, min : 0, unit: "MBytes", placeholder: "None",
                label: "Min. available disk space", helperText: "Reject uploads that don't comply" },
            { k: 'zip_calculate_size_for_seconds', comp: NumberField, label: "Calculate ZIP size for", unit: "seconds",
                helperText: "If time is not enough, the browser will not show download percentage" },
            { k: 'custom_header', multiline: true, sm: 12, md: 6, sx: { '& textarea': { fontFamily: 'monospace' } },
                helperText: "Any HTML code here will be displayed on top of the Frontend"
            },
            { k: 'mime', comp: StringStringField,
                keyLabel: "Files", keyWidth: 7,
                valueLabel: "Mime type", valueWidth: 4
            },
            { k: 'block', label: "Blocked IPs", multiline: true, minRows:3, helperText: "Enter an IP address for each line. CIDR and * are supported.",
                fromField: (all:string) => all.split('\n').map(s => s.trim()).filter(Boolean).map(ip => ({ ip })),
                toField: (all: any) => !Array.isArray(all) ? '' : all.map(x => x?.ip).filter(Boolean).join('\n')
            },
        ]
    })

    async function save() {
        if (_.isEmpty(changes))
            return toast("Nothing to save")
        const loc = window.location
        const keys = ['port','https_port']
        if (keys.every(k => changes[k] !== undefined))
            return alertDialog("You cannot change both http and https port at once. Please, do one, save, and then do the other.", 'warning')
        const working = [status?.http?.listening, status?.https?.listening]
        const onHttps = location.protocol === 'https:'
        if (onHttps) {
            keys.reverse()
            working.reverse()
        }
        const newPort = changes[keys[0]]
        const otherPort = values[keys[1]]
        const otherIsReliable = otherPort > 0 && working[1]
        const otherProtocol = onHttps ? 'http' : 'https'
        if (newPort < 0 && !otherIsReliable)
            return alertDialog("You cannot switch off this port unless you have a working fixed port for " + otherProtocol, 'warning')
        if (newPort === 0 && !otherIsReliable)
            return alertDialog("You cannot randomize this port unless you have a working fixed port for " + otherProtocol, 'warning')
        if (newPort > 0 && !await confirmDialog("You are changing the port and you may be disconnected"))
            return
        if (onHttps && ('cert' in changes || 'private_key' in changes) && !await confirmDialog("You may disrupt https service, kicking you out"))
            return
        await apiCall('set_config', { values: changes })
        if (newPort !== undefined) {
            await alertDialog("You are being redirected but in some cases this may fail. Hold on tight!", 'warning')
            // we have to jump protocol also in case of random port, because we want people to know their port while using GUI
            return window.location.href = newPort <= 0 ? (onHttps ? 'http:' : 'https:') + '//' + loc.hostname + ':' + otherPort + loc.pathname
                : loc.protocol + '//' + loc.hostname + ':' + newPort + loc.pathname
        }
        setTimeout(reloadStatus, 'port' in changes || 'https_port' in changes ? 1000 : 0) // give some time to consider new ports
        Object.assign(loaded!, changes) // since changes are recalculated subscribing state.config, but it depends on 'loaded' to (which cannot be subscribed), be sure to update loaded first
        recalculateChanges()
        toast("Changes applied", 'success')
    }
}

function recalculateChanges() {
    const o: Dict = {}
    if (state.config)
        for (const [k, v] of Object.entries(state.config))
            if (JSON.stringify(v) !== JSON.stringify(loaded?.[k]))
                o[k] = v
    pageState.changes = o
}

export function isCertError(error: any) {
    return /certificate/.test(error)
}

export function isKeyError(error: any) {
    return /private key/.test(error)
}

function ServerPort({ label, value, onChange, getApi, status, suggestedPort=1, error, helperText }: FieldProps<number | null>) {
    const lastCustom = useRef(suggestedPort)
    if (value! > 0)
        lastCustom.current = value!
    const selectValue = Number(value! > 0 ? lastCustom.current : value) || 0
    let errMsg = status?.error
    if (errMsg)
        if (isCertError(errMsg) || isKeyError(errMsg))
            errMsg = undefined // never mind, we'll show this error elsewhere
        else
            error = true
    return h(Box, {},
        h(Box, { display: 'flex' },
            h(SelectField as Field<number>, {
                sx: { flexGrow: 1 },
                label,
                error,
                value: selectValue,
                options: [
                    { label: "off", value: -1 },
                    { label: "random", value: 0 },
                    { label: "choose", value: lastCustom.current },
                ],
                onChange,
            }),
            value! > 0 && h(NumberField, {
                label: "Number",
                fullWidth: false,
                value,
                onChange,
                getApi,
                error,
                min: 1,
                max: 65535,
                helperText,
                sx: { minWidth: '5.5em' }
            }),
        ),
        status && h(FormHelperText, { error },
            status === true ? '...'
                : errMsg ?? (status?.listening && "Correctly working on port " + status.port) )
    )
}

function AllowedReferer({ label, value, onChange, error }: FieldProps<string>) {
    const yesNo = !value || value==='-'
    const example = 'example.com'
    return h(Box, { display: 'flex' },
        h(SelectField as Field<string>, {
            label,
            value: yesNo ? value : example,
            options: { "allow all": '', "forbid all": '-', "allow some": example, },
            onChange,
            error,
            sx: yesNo ? undefined : { maxWidth: '11em' },
        }),
        !yesNo && h(StringField, {
            label: "Domain to allow",
            value,
            placeholder: 'example.com',
            onChange,
            error,
            helperText: "Masks supported"
        })
    )
}

function suggestMakingCert() {
    newDialog({
        Content: () => h(Box, {},
            h(Box, { display: 'flex', gap: 1 },
                h(Info), "You are enabling HTTPs. It needs a valid certificate + private key to work."
            ),
            h(Box, { mt: 4, display: 'flex', gap: 1, justifyContent: 'space-around', },
                h(Button, { variant: 'contained', onClick(){
                    closeDialog()
                    makeCertAndSave().then()
                } }, "Help me!"),
                h(Button, { onClick: closeDialog }, "I will handle the matter myself"),
            ),
        )
    })
}

export async function makeCertAndSave() {
    if (!window.crypto.subtle)
        return alertDialog("Retry this procedure on localhost", 'warning')
    const res = await formDialog<{ commonName: string }>({
        title: "We'll generate a basic certificate for you",
        fields: [
            h(Box, { display: 'flex', gap: 1, alignItems: 'center' }, h(Warning), "This certificate is just one click away, but will issue a warning on the browser"),
            { k: 'commonName', label: "Enter a domain, or leave empty" }
        ],
        save: { children: "Continue" },
        barSx: { gap: 1 },
        addToBar: [ h(Link, { target: 'cert', href: 'https://letsencrypt.org/' }, h(Button, {}, "Get better certificate")) ],

    })
    if (!res) return
    const close = waitDialog()
    try {
        const saved = await apiCall('save_pem', await makeCert(res))
        await apiCall('set_config', { values: saved })
        if (loaded) // when undefined we are not in this page
            Object.assign(loaded, saved)
        setTimeout(exposedReloadStatus!, 1000) // give some time for backend to apply
        Object.assign(state.config, saved)
        await alertDialog("Certificate saved", 'success')
    }
    finally { close() }
}

async function makeCert(attributes: Record<string, string>) {
    // this relies on having loaded node-forge/dist/forge.min.js
    const { pki } = (window as any).forge
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

    const attrs = Object.entries(attributes).map(x => ({ name: x[0], value: x[1] }))
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey)

    return {
        cert: pki.certificateToPem(cert),
        private_key: pki.privateKeyToPem(keys.privateKey),
    }
}
