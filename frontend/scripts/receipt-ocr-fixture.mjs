// Never deploy this isolated test service. It recognizes exact synthetic file
// hashes, rather than making any claim to run OpenThai OCR itself.
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
const expected=JSON.parse(readFileSync('/fixtures/manifest.json','utf8'))
createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||req.headers.apikey!=='local-ocr-fixture'){res.writeHead(401).end();return}
  const request=new Request('http://ocr-fixture'+req.url,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half'})
  const data=await request.formData();const file=data.get('file')
  if(!file||typeof file==='string'){res.writeHead(400).end();return}
  const hash=createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex')
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({text:[expected[hash]??'UNKNOWN RECEIPT'],time:0.01}))
 }catch{res.writeHead(500).end()}
}).listen(9090,'0.0.0.0')
