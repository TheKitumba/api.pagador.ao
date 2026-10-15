import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';

import type { MailTemplateName, MailTemplates } from '../../application/ports';
import { AppConfig } from '../config/app-config';

const APP_NAME = 'pagador.ao';

/** Callout tones: the Badge info/success/warning/danger palette (frontend globals.css), as hex. */
const CALLOUT_STYLE: Record<string, string> = {
  info: 'border:1px solid #d0e2fc; background-color:#e8f1fd; color:#0e4caa;',
  success: 'border:1px solid #d1e7dd; background-color:#e8f3ee; color:#0b653b;',
  warning: 'border:1px solid #f1dac1; background-color:#f9f0e6; color:#884307;',
  danger: 'border:1px solid #f6d3d3; background-color:#fbe9e9; color:#a01818;',
};

/**
 * Renders the Handlebars e-mail templates to HTML (styled with the web app's design system) and a
 * plain-text alternative derived from it. Templates live outside the build, in MAIL_TEMPLATES_DIR
 * (default `templates/emails`, relative to the working directory), and are compiled once, at startup.
 */
@Injectable()
export class MailRenderer {
  private readonly hbs = Handlebars.create();
  private readonly templates = new Map<string, Handlebars.TemplateDelegate>();

  constructor(config: AppConfig) {
    const templatesDir = resolve(config.env.MAIL_TEMPLATES_DIR);
    this.hbs.registerHelper('concat', (...args: unknown[]) => args.slice(0, -1).join(''));
    this.hbs.registerHelper('join', (items: unknown[], separator: string) => items.join(separator));
    this.hbs.registerHelper('calloutStyle', (variant: string) => CALLOUT_STYLE[variant] ?? CALLOUT_STYLE.info);
    // Free text typed by users (announcements): escaped, blank lines → paragraphs, newlines → <br>.
    this.hbs.registerHelper('paragraphs', (text: string) => {
      const html = text
        .trim()
        .split(/\n\s*\n/)
        .map((block) => `<p style="margin:0 0 16px;">${Handlebars.escapeExpression(block).replace(/\n/g, '<br>')}</p>`)
        .join('');
      return new Handlebars.SafeString(html);
    });

    const partialsDir = join(templatesDir, 'partials');
    for (const file of readdirSync(partialsDir).filter((name) => name.endsWith('.hbs'))) {
      this.hbs.registerPartial(basename(file, '.hbs'), readFileSync(join(partialsDir, file), 'utf8'));
    }
    for (const file of readdirSync(templatesDir).filter((name) => name.endsWith('.hbs'))) {
      this.templates.set(basename(file, '.hbs'), this.hbs.compile(readFileSync(join(templatesDir, file), 'utf8'), { strict: true }));
    }
  }

  render<T extends MailTemplateName>(template: T, data: MailTemplates[T], subject: string) {
    const compiled = this.templates.get(template);
    if (!compiled) throw new Error(`Template de e-mail em falta: ${template}.hbs`);
    const html = compiled({ ...data, subject, appName: APP_NAME, year: new Date().getFullYear() });
    return { html, text: toPlainText(html) };
  }
}

/**
 * HTML → readable plain text for the `text/plain` part. Elements marked `data-text-skip` are dropped
 * (they must not contain a nested element of the same tag).
 */
function toPlainText(html: string) {
  return html
    .replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(p|div|td)\b[^>]*\bdata-text-skip\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text}: ${href}` : href;
    })
    .replace(/<\/td>\s*(?=<td)/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|tr|table)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3D;/g, '=')
    .replace(/&#x60;/g, '`')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
