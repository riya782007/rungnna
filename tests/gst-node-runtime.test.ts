import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { expect, it } from "vitest";
it("loads shared GST helpers in native Node ESM without browser or extensionless runtime imports",()=>{
  const folder=mkdtempSync(join(tmpdir(),"rungnna-gst-runtime-"));
  try {
    writeFileSync(join(folder,"package.json"),'{"type":"module"}');
    for (const name of ["gst","allocate"]) writeFileSync(join(folder,name+".js"),ts.transpileModule(readFileSync(new URL("../src/lib/"+name+".ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText);
    const uri=pathToFileURL(join(folder,"gst.js")).href;
    const output=execFileSync(process.execPath,["--input-type=module","-e","const m=await import("+JSON.stringify(uri)+"); console.log(m.gstDate('2026-10-19T00:00:00Z'));"],{encoding:"utf8"});
    expect(output.trim()).toBe("19/10/2026");
  } finally { for (const file of ["package.json","gst.js","allocate.js"]) { const path=join(folder,file); if(existsSync(path)) unlinkSync(path); } rmdirSync(folder); }
});
