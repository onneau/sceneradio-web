// De zenderlijst en de serverinstellingen ophalen en in de gedeelde toestand zetten.
import { api } from './api.js';
import { update } from './state.js';

export async function loadConfig() {
  const config = await api('/api/config');
  update({ config });
  return config;
}

export async function loadStations() {
  try {
    const data = await api('/api/stations');
    update({ stations: data.stations, updatedAt: data.updatedAt, loadError: data.error || '', loading: false });
  } catch (error) {
    update({ loading: false, loadError: error.message });
  }
}

