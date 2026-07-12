# Grue Learner

This repository is very rough in nature. It is being used to build up a pedagogical Z-Machine interpreter implementation. If anyone stumbles across this, I would not use this right now for anything unless it's code spelunking to see what I'm doing.

To execute:

```sh
pnpm start
```

To run the object dumper utility:

```sh
node .\\src\\dumpObjects.ts ..\\zcode\\zork1-invclues-r52-s871125.z5 properties
```

```sh
node .\\src\\dumpObjects.ts ..\\zcode\\zork1-invclues-r52-s871125.z5 tree
```

```sh
node .\\src\\dumpInstruction.ts ..\\zcode\\zork1-invclues-r52-s871125.z5 54c4
```

To play a game online:

- [https://iplayif.com/](https://iplayif.com/)
