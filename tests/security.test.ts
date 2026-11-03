import test from 'node:test';
import assert from 'node:assert/strict';
import {safeReturnPath,isSameOrigin,extractQrToken,csvCell} from '../src/lib/security';
test('return paths never redirect to an external origin',()=>{
 for(const value of ['https://evil.example','//evil.example','/\\evil.example','/\n/evil.example','/\t/evil.example','/a/..//evil.example',null,42])assert.equal(safeReturnPath(value),'/app');
 assert.equal(safeReturnPath('/join?token=test'),'/join?token=test');
});
test('mutating endpoint origin validation fails closed',()=>{
 assert.equal(isSameOrigin(new Request('https://edusafe.example/api/actions',{headers:{origin:'https://edusafe.example'}})),true);
 assert.equal(isSameOrigin(new Request('https://edusafe.example/api/actions',{headers:{origin:'https://evil.example'}})),false);
 assert.equal(isSameOrigin(new Request('https://edusafe.example/api/actions')),false);
 assert.equal(isSameOrigin(new Request('https://edusafe.example/api/actions',{headers:{origin:'null'}})),false);
});
test('QR scanner accepts only local check-in URLs or expected opaque tokens',()=>{
 const token='a'.repeat(64);const origin='https://edusafe.example';
 assert.equal(extractQrToken(`${origin}/check-in?token=${token}`,origin),token);
 assert.equal(extractQrToken(token,origin),token);
 assert.equal(extractQrToken(`https://evil.example/check-in?token=${token}`,origin),null);
 assert.equal(extractQrToken(`javascript:alert(1)`,origin),null);
 assert.equal(extractQrToken(`${origin}/api/actions?token=${token}`,origin),null);
 assert.equal(extractQrToken('12345',origin),null);
});
test('CSV cells escape quotes and spreadsheet formula prefixes',()=>{
 assert.equal(csvCell('=SUM(A1:A2)'),`"'=SUM(A1:A2)"`);
 assert.equal(csvCell('  +123'),`"'  +123"`);
 assert.equal(csvCell('Айша "А"'),`"Айша ""А"""`);
 assert.equal(csvCell(null),'""');
});
