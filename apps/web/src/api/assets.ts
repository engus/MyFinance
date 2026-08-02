import { CreateAssetInput, CreateLiabilityInput, CreateValuationInput } from '@myfinance/contracts';
import { apiFetch } from './client';

export interface Asset {
  id: string;
  type: string;
  ownershipShare: string;
  countryCode: string | null;
  region: string | null;
  institution: string | null;
  notes: string | null;
  account: { id: string; name: string; currency: string; subtype: string; isArchived: boolean };
  currentValuation: {
    id: string;
    amount: string;
    currency: string;
    valuationDate: string;
    source: string;
  } | null;
  valuations: Array<{
    id: string;
    amount: string;
    currency: string;
    valuationDate: string;
    source: string;
  }>;
}

export interface Liability {
  id: string;
  name: string;
  subtype: string;
  currency: string;
  balance: string;
  liabilityProfile: {
    creditor: string | null;
    annualInterestRate: string | null;
    maturityDate: string | null;
  } | null;
}

export const fetchAssets = () => apiFetch<Asset[]>('/assets');
export const createAsset = (input: CreateAssetInput) =>
  apiFetch<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) });
export const updateAsset = (id: string, input: Record<string, unknown>) =>
  apiFetch<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
export const addValuation = (id: string, input: CreateValuationInput) =>
  apiFetch(`/assets/${id}/valuations`, { method: 'POST', body: JSON.stringify(input) });
export const fetchLiabilities = () => apiFetch<Liability[]>('/liabilities');
export const createLiability = (input: CreateLiabilityInput) =>
  apiFetch<Liability>('/liabilities', { method: 'POST', body: JSON.stringify(input) });
export const updateLiability = (id: string, input: Record<string, unknown>) =>
  apiFetch<Liability>(`/liabilities/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
