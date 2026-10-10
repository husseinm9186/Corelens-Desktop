/**
 * The address register, on a screen of its own.
 *
 * It used to be two tabs in the bottom panel — "Addresses" for the table and
 * "IPAM" for the hierarchy and the tools — which is a distinction that exists
 * because one was built before the other, and which nobody could explain. They
 * are one thing: the register. This is that thing, with the table as its first
 * view.
 *
 * A screen rather than a panel because the register is not *about* the diagram.
 * It is the second job this application does, and the tall views — a split
 * review, a deep hierarchy — were being clipped by a panel sized for watching a
 * scan run.
 *
 * The diagram stays mounted behind it, so leaving comes back to the same
 * selection and the same viewport.
 */
import { useMemo, useState } from 'react';

import { t } from '../i18n';
import { buildIpam } from '../lib/ipam';
import { allNodes } from '../lib/pages';
import { ChromeIcon } from './chromeIcons';
import { IpamDashboard } from './IpamDashboard';
import { IpamPanel } from './IpamPanel';
import { IpamSetup } from './IpamSetup';
import { IpamWorkbench } from './IpamWorkbench';
import { ScreenFrame } from './ScreenFrame';
import { SubnetTree } from './SubnetTree';
import { useStore } from '../state/store';

/**
 * Three views, which is what the register is for: the addresses, how full
 * the subnets are, and what has changed. Allocating and splitting are things
 * done *to* a subnet, so they are a toolbar on the one chosen in the tree;
 * the hierarchy of containers and VRFs is a tool beside them; the sites,
 * tenants and custom fields are configuration, behind the cog.
 */
type View = 'addresses' | 'dashboard' | 'history' | 'setup';
type Tool = 'addresses' | 'allocate' | 'split' | 'hierarchy';

const VIEWS: { id: Exclude<View, 'setup'>; label: () => string }[] = [
  { id: 'addresses', label: () => t('register.addresses') },
  { id: 'dashboard', label: () => t('dash.title') },
  { id: 'history', label: () => t('lab.history') },
];

export function RegisterScreen() {
  const close = useStore((s) => s.setRegisterOpen);
  const doc = useStore((s) => s.doc);
  const model = useMemo(() => buildIpam(allNodes(doc), doc.ipam), [doc]);
  const [view, setView] = useState<View>('addresses');
  const [tool, setTool] = useState<Tool>('addresses');
  // The subnet chosen in the tree, as `<vrf>|<cidr>`; null is all of them.
  const [selected, setSelected] = useState<string | null>(null);
  const block = selected ? model.blocks.find((b) => `${b.vrfId}|${b.cidr}` === selected) : undefined;
  const toolButton = (id: Exclude<Tool, 'addresses'>, label: string, needsSubnet: boolean) => (
    <button
      type="button"
      className={`cv-btn cv-btn-small${tool === id ? ' is-active' : ''}`}
      aria-pressed={tool === id}
      disabled={needsSubnet && !block}
      title={needsSubnet && !block ? t('register.chooseSubnetFirst') : undefined}
      onClick={() => setTool(tool === id ? 'addresses' : id)}
    >
      {label}
    </button>
  );

  return (
    <ScreenFrame
      title={t('register.title')}
      region="register"
      tabs={VIEWS.map((v) => ({ id: v.id, label: v.label() }))}
      active={view === 'setup' ? undefined : view}
      onTab={(id) => {
        setView(id);
        // Addresses again is the way back from a tool to the table.
        if (id === 'addresses') setTool('addresses');
      }}
      onClose={() => close(false)}
      actions={(
        <button
          type="button"
          className={`cv-icon-btn cv-register-setup${view === 'setup' ? ' is-on' : ''}`}
          data-region="register-setup"
          aria-pressed={view === 'setup'}
          aria-label={t('register.setup')}
          title={t('register.setup')}
          onClick={() => setView(view === 'setup' ? 'addresses' : 'setup')}
        >
          <ChromeIcon name="settings" size={16} />
        </button>
      )}
      tree={view === 'addresses' ? (
        <SubnetTree model={model} selected={selected} onSelect={(key) => { setSelected(key); if (!key && tool !== 'hierarchy') setTool('addresses'); }} />
      ) : undefined}
    >
      {view === 'addresses' ? (
        <div className="cv-register-pane">
          <div className="cv-register-tools" data-region="subnet-tools" role="toolbar" aria-label={t('register.subnetTools')}>
            <span className="cv-register-chosen">
              {block ? (
                <><span className="cv-mono">{block.cidr}</span>{block.name && <span className="cv-register-chosen-name"> · {block.name}</span>}</>
              ) : (
                t('register.allSubnets')
              )}
            </span>
            {toolButton('allocate', t('lab.allocate'), false)}
            {toolButton('split', t('lab.splitMerge'), false)}
            {toolButton('hierarchy', t('lab.hierarchy'), false)}
          </div>
          {tool === 'addresses' ? (
            <IpamPanel focus={block?.cidr} />
          ) : (
            <IpamWorkbench view={tool} selected={selected ?? undefined} />
          )}
        </div>
      ) : view === 'dashboard' ? (
        <IpamDashboard />
      ) : view === 'setup' ? (
        <IpamSetup />
      ) : (
        <IpamWorkbench view="history" />
      )}
    </ScreenFrame>
  );
}
