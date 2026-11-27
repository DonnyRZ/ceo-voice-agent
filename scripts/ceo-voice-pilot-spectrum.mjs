const size = 256;
const bandEdges = [1, 2, 3, 4, 5, 7, 9, 12, 16, 21, 28, 38, 51, 68, 91, 128];
const window = Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
const bitReverse = Array.from({ length: size }, (_, i) => {
  let output = 0;
  for (let bit = 0; bit < 8; bit += 1) output = (output << 1) | ((i >> bit) & 1);
  return output;
});
const rotations = Array.from({ length: size / 2 }, (_, i) => ({
  real: Math.cos(-2 * Math.PI * i / size),
  imaginary: Math.sin(-2 * Math.PI * i / size),
}));

// Band magnitudes survive audio capture resampling and codec phase changes.
export function spectralBands(audio, hop) {
  const frames = Math.max(0, 1 + Math.floor((audio.length - size) / hop));
  const bands = bandEdges.length - 1;
  const values = new Float32Array(frames * bands);
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let frame = 0; frame < frames; frame += 1) {
    imaginary.fill(0);
    for (let i = 0; i < size; i += 1) real[bitReverse[i]] = audio[frame * hop + i] * window[i];
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      for (let start = 0; start < size; start += width) {
        for (let offset = 0; offset < half; offset += 1) {
          const left = start + offset;
          const right = left + half;
          const rotation = rotations[offset * size / width];
          const r = real[right] * rotation.real - imaginary[right] * rotation.imaginary;
          const im = real[right] * rotation.imaginary + imaginary[right] * rotation.real;
          real[right] = real[left] - r;
          imaginary[right] = imaginary[left] - im;
          real[left] += r;
          imaginary[left] += im;
        }
      }
    }
    for (let band = 0; band < bands; band += 1) {
      let power = 0;
      for (let frequency = bandEdges[band]; frequency < bandEdges[band + 1]; frequency += 1) {
        power += real[frequency] ** 2 + imaginary[frequency] ** 2;
      }
      values[frame * bands + band] = Math.log1p(Math.sqrt(power) / 300);
    }
  }
  return { bands, values };
}
