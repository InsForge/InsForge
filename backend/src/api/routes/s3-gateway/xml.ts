import { Builder, Parser } from 'xml2js';

const builder = new Builder({
  xmldec: { version: '1.0', encoding: 'UTF-8' },
  renderOpts: { pretty: false },
  headless: false,
});

export function toXml(root: Record<string, unknown>): string {
  return builder.buildObject(root);
}

const parser = new Parser({
  explicitArray: false,
  trim: true,
});

export async function parseXml(input: string | Buffer): Promise<unknown> {
  return parser.parseStringPromise(input.toString('utf8'));
}
