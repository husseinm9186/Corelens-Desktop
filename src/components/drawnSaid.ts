/**
 * What a link filled in from the devices rests on, in a sentence: which
 * device reported it, what it said it saw, and what matched that to a
 * device on the page. Shown on the link's tooltip and in its details, so a
 * cable that looks wrong can be traced to the report it came from.
 */
import { t } from '../i18n';
import type { DrawnSaid } from '../types/domain';

export function drawnSaidText(said: DrawnSaid | undefined): string | null {
  if (!said) return null;
  const port = said.port ? ` ${said.port}` : '';
  if (said.match === 'mac') return t('drawn.said.mac', { by: said.by, port, saw: said.saw });
  const sawPort = said.sawPort ? ` ${said.sawPort}` : '';
  return (
    t('drawn.said.neighbour', { by: said.by, port, saw: said.saw, sawPort, match: t(`drawn.match.${said.match}`) }) +
    (said.both ? t('drawn.said.both') : '') +
    (said.segment ? t('drawn.said.segment') : '')
  );
}
