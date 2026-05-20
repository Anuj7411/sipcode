// v4 bound chain to res.send; removed in v5.
export const ok = (res) => res.send.bind(res);
