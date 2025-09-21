### CurvedTimeLayer: analytic verticality condition and roots (Lambert W)

This note derives a closed-form solution for the positions where a tick in `CurvedTimeLayer` is vertical. Those positions are the points where the horizontal offset between the log-space origin and the linear-space target vanishes.

#### Setup

Let the timeline center be at time \(t_c\) and pixel center \(x_c\). The visible width is \(W\). We index log ticks by an integer index \(i\), with sign \(s=\operatorname{sign}(i)\in\{-1,1\}\) and magnitude \(v=|i|\ge 0\). We use the parameters:

- \(K\): total number of intervals across the width used for the log-layout grid
- \(\text{maxExp}\): the maximum base-10 exponent at the edges
- \(\alpha\): pixels per millisecond (affine time-to-pixel slope)

Mappings used by the layer:

- Log-space x-position: \[ x_{\log}(i) = x_m + \frac{W}{K} i, \quad x_m = \frac{W}{2}. \]
- Linear-space x-position of the target for index \(i\): \[ x_{\lin}(i) = x_c + \alpha\, \Delta(i), \quad \Delta(i) = s\,\underbrace{10^{c v}}_{\text{seconds}}\cdot 10^3, \]
  where \(c = \tfrac{\text{maxExp}}{K/2} = \tfrac{2\,\text{maxExp}}{K}\).

A tick is vertical when its horizontal component vanishes, i.e.
\[ x_{\lin}(i) - x_{\log}(i) = 0. \]

Substitute definitions and separate by side \(s\):
\[ x_c + \alpha \cdot s\, 10^{c v}\cdot 10^3 \;=\; x_m + \frac{W}{K} s v. \]
Rearrange with \(D = x_m - x_c\):
\[ \alpha 10^3\,10^{c v} \;=\; \frac{W}{K} v + s D. \]

Define constants
\[ p = \frac{W}{K}, \quad q = s D, \quad r = \alpha\cdot 10^3, \quad a = c \ln 10, \]
and note \(10^{c v} = e^{a v}\). The verticality condition is
\[ p v + q = r\, e^{a v}. \tag{1}\]

#### Closed-form solution with Lambert W

Let \(u = v + \tfrac{q}{p}\). Then \(p u = r e^{a(u - q/p)} = r e^{a u} e^{-a q/p}\), so
\[ u\, e^{-a u} = \frac{r}{p} e^{-a q/p}. \]
Multiply both sides by \(-a\):
\[ (-a u) e^{-a u} = -\frac{a r}{p} e^{-a q/p}. \]
Using the Lambert W function \(W_k\) (branch \(k\)), we obtain
\[ -a u = W_k\!\left( -\frac{a r}{p} e^{-a q/p} \right). \]
Therefore, the solutions are
\[ v_k = -\frac{1}{a} W_k\!\left( -\frac{a r}{p} e^{-a q/p} \right) - \frac{q}{p}. \tag{2}\]

Each side \(s\in\{-1,1\}\) yields a distinct \(q=s D\) and thus a distinct argument to \(W\). Real roots arise from real branches \(k\in\{0,-1\}\) when the argument
\[ z_s = -\frac{a r}{p} e^{-a (s D)/p} \]
lies in \([-1/e, 0]\). This produces up to two real roots per side. Restricting to the domain \(v\in[0, K/2]\), you may observe between 0 and 2 valid roots per side; combining both sides gives up to three distinct valid roots in typical parameter regimes.

#### Coordinates of the vertical points

For each valid \(v_k\ge 0\) within \([0, K/2]\), form \(i_k = s\, v_k\) and compute the on-canvas position at the log anchor:
\[ x_k = x_m + \frac{W}{K} i_k, \qquad y_k = 10 + i_k^2. \]
These are the red dots to draw; they move continuously with \(x_c\) and \(\alpha\) as the view changes.

#### Practical notes

- Numerical stability: Use a robust Lambert W implementation for real branches \(k=0,-1\); clamp or skip roots whose \(v_k\) falls outside \([0, K/2]\).
- Degenerate cases: If \(z_s\in\{0,-1/e\}\), the branches merge and multiplicity changes; handle accordingly.
- Units: \(\alpha\) is px/ms; \(r=\alpha\cdot 10^3\) accounts for ms after expressing \(10^{c v}\) in seconds.

#### Mapping to code

- \(W\Rightarrow\) `width`, \(K\Rightarrow\) `K`, \(\text{maxExp}\Rightarrow\) `maxExp`
- \(x_m = W/2\Rightarrow\) `middle`, \(x_c\Rightarrow\) `calibration.xCenter`
- \(\alpha = \text{calibration.a}\) (pixels per millisecond)
- \(a = (\text{maxExp}\cdot 2/K)\cdot \ln 10\)

Implement by computing, for each side `s` in `[-1, +1]`,
\[ v_k = -\frac{1}{a} W_k\!\left( -\frac{a (\alpha 10^3)}{W/K} e^{-a s (x_m - x_c)/(W/K)} \right) - \frac{s (x_m - x_c)}{W/K}. \]
Keep roots within the domain, then map to `(x_k, y_k)` as above.


