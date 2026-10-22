export function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollD20() {
  return rollDie(20);
}

export function rollDice(count, sides) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += rollDie(sides);
  return sum;
}
