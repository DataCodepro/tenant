#!/usr/bin/env python3
"""
Turns your REAL field data (CSV files) into the numbers for Tables 4.7 - 4.10 and 4.12.
Usage:  python3 tools/analyze_results.py <folder with sus.csv, tasks.csv, tam.csv[, compare.csv]>

sus.csv      participant_id,group,q1,...,q10                (answers 1-5; group = Tenant | Landlord | Maintenance Staff)
tasks.csv    participant_id,group,task,completed,seconds,errors     (completed = 1 or 0)
tam.csv      participant_id,group,pu_mean,peou_mean          (mean of each participant's usefulness / ease-of-use Likert items)
compare.csv  indicator,existing,proposed                     (optional; your measured values for Table 4.12)
"""
import csv, sys, statistics as st, os
from collections import defaultdict

def rd(p):
    with open(p, newline='', encoding='utf-8') as f: return list(csv.DictReader(f))

def sus_score(row):
    tot = 0
    for i in range(1, 11):
        v = int(row[f'q{i}'])
        tot += (v - 1) if i % 2 == 1 else (5 - v)      # odd: response-1, even: 5-response
    return tot * 2.5                                     # Brooke (1996)

def band(x):   # Bangor et al. (2008) as used in Section 4.8.3
    return 'Acceptable' if x > 70 else 'Marginal' if x >= 50 else 'Not acceptable'

def sd(v): return st.stdev(v) if len(v) > 1 else 0.0

def main(d):
    print('\n### Table 4.7 Participants')
    sus = rd(os.path.join(d, 'sus.csv')); g = defaultdict(list)
    for r in sus: g[r['group']].append(sus_score(r))
    for k, v in g.items(): print(f'{k}: n={len(v)}')
    print(f'Total: {len(sus)}')

    tp = os.path.join(d, 'tasks.csv')
    if os.path.exists(tp):
        print('\n### Table 4.8 Task completion, time and errors')
        t = defaultdict(list)
        for r in rd(tp): t[(r['task'], r['group'])].append(r)
        print('Task | Role | Completion % | Mean time (s) | Mean errors')
        for (task, grp), rows in t.items():
            comp = 100 * sum(int(x['completed']) for x in rows) / len(rows)
            tm = st.mean(float(x['seconds']) for x in rows if int(x['completed']))  if any(int(x['completed']) for x in rows) else float('nan')
            er = st.mean(float(x['errors']) for x in rows)
            print(f'{task} | {grp} | {comp:.0f} | {tm:.1f} | {er:.2f}')

    print('\n### Table 4.9 SUS by group')
    print('Group | n | Mean SUS | SD | Interpretation')
    for k, v in g.items(): print(f'{k} | {len(v)} | {st.mean(v):.1f} | {sd(v):.1f} | {band(st.mean(v))}')
    allv = [x for v in g.values() for x in v]
    print(f'All participants | {len(allv)} | {st.mean(allv):.1f} | {sd(allv):.1f} | {band(st.mean(allv))}')

    tam = os.path.join(d, 'tam.csv')
    if os.path.exists(tam):
        print('\n### Table 4.10 TAM ratings (1-5)')
        pu, pe = defaultdict(list), defaultdict(list)
        for r in rd(tam): pu[r['group']].append(float(r['pu_mean'])); pe[r['group']].append(float(r['peou_mean']))
        for name, dct in (('Perceived usefulness', pu), ('Perceived ease of use', pe)):
            allv = [x for v in dct.values() for x in v]
            print(name, '|', ' | '.join(f'{k}: {st.mean(v):.2f}' for k, v in dct.items()), f'| Overall: {st.mean(allv):.2f}')

    cp = os.path.join(d, 'compare.csv')
    if os.path.exists(cp):
        print('\n### Table 4.12 Existing vs proposed')
        print('Indicator | Existing | Proposed | Difference')
        for r in rd(cp):
            try: dif = f"{float(r['proposed']) - float(r['existing']):+.2f}"
            except ValueError: dif = 'n/a'
            print(f"{r['indicator']} | {r['existing']} | {r['proposed']} | {dif}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'tools/sample_data')
