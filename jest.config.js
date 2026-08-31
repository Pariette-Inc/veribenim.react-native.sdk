module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // React Native ve React yalnızca UI bileşeninde kullanılıyor; testler
  // çekirdeği doğrudan modül yolundan çağırır, bu yüzden RN kurulu olmadan koşar.
  testPathIgnorePatterns: ['/node_modules/'],
};
