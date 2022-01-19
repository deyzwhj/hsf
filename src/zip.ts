import { VfsNode, walkNode } from './vfs'
import Koa from 'koa'
import { filterMapGenerator, pattern2filter } from './misc'
import { QuickZipStream } from './QuickZipStream'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import { getConfig } from './config'

export async function zipStreamFromFolder(node: VfsNode, ctx: Koa.Context) {
    ctx.status = 200
    ctx.mime = 'zip'
    const { name } = node
    ctx.attachment((name || 'archive') + '.zip')
    const filter = pattern2filter(String(ctx.query.search||''))
    const walker = filterMapGenerator(walkNode(node, ctx, Infinity), async (el:VfsNode) => {
        const { source } = el
        if (!source || ctx.req.aborted || !filter(el.name))
            return
        try {
            const st = await fs.stat(source)
            if (!st || !st.isFile())
                return
            return {
                path: el.name,
                size: st.size,
                ts: st.mtime || st.ctime,
                getData: () => createReadStream(source)
            }
        }
        catch {}
    })
    const zip = new QuickZipStream(walker)
    const time = 1000 * (getConfig('zip-calculate-size-for-seconds') ?? 1)
    ctx.response.length = await zip.calculateSize(time)
    ctx.body = zip
    ctx.req.on('close', ()=> zip.destroy())
}
