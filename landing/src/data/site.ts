export const company = {
  name: 'Elround Network',
  legalName: 'PT Elround Lintas Nusantara',
  partner: 'PT ION Network',
  phoneDisplay: '0838-9996-3100',
  phoneInternational: '6283899963100',
  email: 'support@elround.net',
  portalUrl: '/customer/signin',
  address: 'Jl. Raya Banjaratma, Gg. Jeruk, RT 01/RW 03, No. 11, Brebes 52253',
  areas: ['Banjaratma', 'Petunjungan', 'Tegalglagah', 'Banjarsari', 'Cipugur'],
  instagram: 'https://www.instagram.com/elround_net/',
  instagramDisplay: '@elround_net',
};

export const plans = [
  { id: 'lite', name: 'P-Lite', speed: 15, price: 100000, description: 'Browsing ringan dan chat', offer: 'Promo pemasangan Rp100.000 (normal Rp200.000). Hemat Rp100.000 biaya pemasangan', mascot: '/mascots/lite.webp', tone: 'mint' },
  { id: 'reguler', name: 'P-Reguler', speed: 25, price: 120000, description: 'Browsing, sosmed, dan chat', offer: 'Promo pemasangan Rp60.000 (normal Rp180.000). Hemat Rp120.000 biaya pemasangan', mascot: '/mascots/reguler.webp', tone: 'sky', highlight: 'Pilihan hemat' },
  { id: 'fast', name: 'P-Fast', speed: 40, price: 150000, description: 'Kerja dan belajar online', offer: 'Bulan pertama Rp150.000, termasuk pemasangan', mascot: '/mascots/fast.webp', tone: 'blue', highlight: 'Rekomendasi' },
  { id: 'turbo', name: 'P-Turbo', speed: 55, price: 180000, description: 'Streaming Full HD dan meeting', offer: 'Bulan pertama Rp150.000, termasuk pemasangan. Hemat Rp30.000', mascot: '/mascots/turbo.webp', tone: 'orange' },
  { id: 'sonic', name: 'P-Sonic', speed: 75, price: 220000, description: 'Gaming dan streaming', offer: 'Bulan pertama Rp150.000, termasuk pemasangan. Hemat Rp70.000', mascot: '/mascots/sonic.webp', tone: 'gold' },
  { id: 'hyper', name: 'P-Hyper', speed: 100, price: 250000, description: 'Banyak perangkat di rumah', offer: 'Bulan pertama Rp150.000, termasuk pemasangan. Hemat Rp100.000', mascot: '/mascots/hyper.webp', tone: 'red', highlight: 'Premium best value' },
  { id: 'ultimate', name: 'P-Ultimate', speed: 140, price: 300000, description: 'Kebutuhan internet intensif', offer: 'Bulan pertama Rp150.000, termasuk pemasangan. Hemat Rp150.000', mascot: '/mascots/ultimate.webp', tone: 'navy' },
] as const;

export const formatRupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
export const whatsappUrl = (message: string) => `https://wa.me/${company.phoneInternational}?text=${encodeURIComponent(message)}`;
