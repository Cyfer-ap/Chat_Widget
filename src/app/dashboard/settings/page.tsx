'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useSupabaseAuth } from '@/lib/useAuth';
import { info } from '@/lib/logger';

export default function SettingsPage() {
  const { session } = useSupabaseAuth();
  const [tenantId, setTenantId] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('chat_widget_tenant_id');
    if (stored) setTenantId(stored);
  }, []);

  const load = async () => {
    if (!tenantId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data, error: err } = await supabase
      .from('tenant_sites')
      .select('allowed_domain')
      .eq('tenant_id', tenantId);
    if (err) return setError(err.message);
    setDomains((data ?? []).map((r: any) => r.allowed_domain));
  };

  useEffect(() => {
    void load();
  }, [tenantId]);

  const addDomain = async () => {
    setError(null);
    if (!tenantId || !newDomain) return setError('Missing tenant or domain');
    const supabase = getSupabaseClient();
    if (!supabase) return setError('Missing supabase client');
    const { error: err } = await supabase
      .from('tenant_sites')
      .insert({ tenant_id: tenantId, allowed_domain: newDomain });
    if (err) return setError(err.message);
    info('Tenant site added', { tenantId, domain: newDomain });
    setNewDomain('');
    void load();
  };

  const removeDomain = async (domain: string) => {
    if (!tenantId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { error: err } = await supabase
      .from('tenant_sites')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('allowed_domain', domain);
    if (err) return setError(err.message);
    info('Tenant site removed', { tenantId, domain });
    void load();
  };

  if (!session) return <div>Please sign in to manage tenant settings.</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Tenant settings</h2>
      <div>
        <label htmlFor="tenant-id" className="block text-sm">
          Tenant ID
        </label>
        <input
          id="tenant-id"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="w-full rounded border px-2 py-1"
        />
      </div>

      <div>
        <h3 className="font-medium">Allowed domains</h3>
        <ul>
          {domains.map((d) => (
            <li key={d} className="flex items-center gap-2">
              <span>{d}</span>
              <button className="ml-2 text-sm text-red-600" onClick={() => removeDomain(d)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="example.com"
            className="rounded border px-2 py-1"
          />
          <button onClick={addDomain} className="rounded bg-blue-600 px-3 py-1 text-white">
            Add
          </button>
        </div>
        {error ? <div className="text-red-600">{error}</div> : null}
      </div>
    </div>
  );
}
