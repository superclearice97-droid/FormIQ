import json, sys, math, glob
import numpy as np
from scipy.signal import find_peaks
def sig(f, kind, asp):
    L=f["lm"]; v=lambda i:L[i]["visibility"]>0.35
    T=None
    if kind=="arms":   # wrists above shoulders
        vals=[(L[s]["y"]-L[w]["y"]) for s,w in ((11,15),(12,16)) if v(s) and v(w)]
        return np.mean(vals) if vals else np.nan
    if kind=="leg":    # minus hip height over shin (higher = deeper squat)
        r=[]
        for h,k,a in ((23,25,27),(24,26,28)):
            if v(h) and v(k) and v(a):
                sh=math.hypot((L[k]["x"]-L[a]["x"])*asp,L[k]["y"]-L[a]["y"])
                if sh>0.03: r.append(-(L[a]["y"]-L[h]["y"])/sh)
        return np.mean(r) if r else np.nan
    if kind=="sit":    # torso angle up from the floor
        W=f["w"]; s=[(W[11][q]+W[12][q])/2 for q in "xyz"]; h=[(W[23][q]+W[24][q])/2 for q in "xyz"]
        d=[s[i]-h[i] for i in range(3)]; return -d[1]/math.sqrt(sum(x*x for x in d))
for path in sorted(glob.glob(sys.argv[1])):
    d=json.load(open(path)); kind=sys.argv[2]; asp=float(sys.argv[3]); fps=d.get("fps",30)
    x=np.array([sig(f,kind,asp) if "lm" in f else np.nan for f in d["frames"]],float)
    ok=~np.isnan(x)
    if ok.sum()<10: print(path,"no data"); continue
    x=np.interp(np.arange(len(x)),np.where(ok)[0],x[ok])
    k=max(1,int(fps*0.15)); x=np.convolve(x,np.ones(k)/k,mode="same")
    rng=np.percentile(x,95)-np.percentile(x,5)
    p,_=find_peaks(x,prominence=0.4*rng,distance=int(fps*0.35))
    print(f"{path.split('/')[-1]:28s} ref={len(p):3d} range={rng:.2f}")
