import type { VehicleDisplayCurrent } from './api-client';

// Isolated visual fixtures: never used for a paired display or sent to the server.
const sampleDriver: VehicleDisplayCurrent['driver'] = {
  name: 'Pengemudi Contoh',
  plate: 'CT1234',
  vehicleModel: 'Kendaraan Contoh',
  photoUrl: null,
};

export const standbyPreview: VehicleDisplayCurrent = {
  driver: sampleDriver,
  order: null,
};

export const tripPreview: VehicleDisplayCurrent = {
  driver: sampleDriver,
  order: {
    id: 'contoh-001',
    service: 'ride',
    status: 'in_progress',
    pickup: { address: 'Hotel Indonesia, Jakarta Pusat' },
    destination: { address: 'Stasiun Gambir, Jakarta Pusat' },
    distance: 5.2,
    eta: 12,
    price: 25000,
    payment: 'cash',
  },
};

// Approximate route fixtures used only by the visual preview.
export const tripPreviewCoordinates = {
  pickup: { latitude: -6.1950, longitude: 106.8230 },
  destination: { latitude: -6.1767, longitude: 106.8307 },
} as const;