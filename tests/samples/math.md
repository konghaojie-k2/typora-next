# Mathematical Formulas Test

## Inline Math

The famous equation $E = mc^2$ relates energy and mass.

The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$.

The area of a circle is $A = \pi r^2$.

Euler's identity $e^{i\pi} + 1 = 0$ is considered beautiful.

The Pythagorean theorem states $a^2 + b^2 = c^2$.

## Block Math

### Basic Equations

$$
f(x) = x^2 + 2x + 1
$$

$$
g(x) = \frac{1}{x} + \sqrt{x}
$$

$$
h(x) = \log_2(x) + \ln(x)
$$

### Calculus

#### Derivatives

$$
\frac{d}{dx}\left(x^n\right) = nx^{n-1}
$$

$$
\frac{d}{dx}\left(\sin x\right) = \cos x
$$

$$
\frac{d}{dx}\left(e^x\right) = e^x
$$

#### Integrals

$$
\int_0^1 x^2 \, dx = \left[\frac{x^3}{3}\right]_0^1 = \frac{1}{3}
$$

$$
\int e^x \, dx = e^x + C
$$

$$
\int \frac{1}{x} \, dx = \ln|x| + C
$$

#### Multiple Integrals

$$
\iint_D f(x,y) \, dA = \int_a^b \int_c^d f(x,y) \, dy \, dx
$$

$$
\iiint_V \rho(x,y,z) \, dV
$$

### Limits

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

$$
\lim_{x \to \infty} \frac{x^2 + 1}{2x^2 + 3} = \frac{1}{2}
$$

### Summations and Products

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

$$
\sum_{i=0}^{\infty} \frac{1}{2^i} = 2
$$

$$
\prod_{i=1}^{n} i = n!
$$

### Matrices

#### Simple Matrix

$$
A = \begin{pmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{pmatrix}
$$

#### Matrix Operations

$$
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
\begin{bmatrix}
x \\
y
\end{bmatrix}
=
\begin{bmatrix}
ax + by \\
cx + dy
\end{bmatrix}
$$

#### Identity Matrix

$$
I_n = \begin{pmatrix}
1 & 0 & \cdots & 0 \\
0 & 1 & \cdots & 0 \\
\vdots & \vdots & \ddots & \vdots \\
0 & 0 & \cdots & 1
\end{pmatrix}
$$

### Trigonometry

$$
\sin^2\theta + \cos^2\theta = 1
$$

$$
\sin(\alpha + \beta) = \sin\alpha\cos\beta + \cos\alpha\sin\beta
$$

$$
\cos(2\theta) = \cos^2\theta - \sin^2\theta = 2\cos^2\theta - 1
$$

### Complex Numbers

$$
z = a + bi = re^{i\theta}
$$

$$
e^{i\theta} = \cos\theta + i\sin\theta
$$

$$
|z| = \sqrt{a^2 + b^2}
$$

### Probability and Statistics

#### Normal Distribution

$$
f(x) = \frac{1}{\sigma\sqrt{2\pi}} e^{-\frac{(x-\mu)^2}{2\sigma^2}}
$$

#### Expected Value

$$
E[X] = \sum_{i=1}^{n} x_i P(x_i)
$$

#### Variance

$$
\text{Var}(X) = E[(X - \mu)^2] = E[X^2] - (E[X])^2
$$

### Physics Equations

#### Newton's Second Law

$$
\vec{F} = m\vec{a} = m\frac{d\vec{v}}{dt}
$$

#### Schrodinger Equation

$$
i\hbar\frac{\partial}{\partial t}\Psi(\vec{r},t) = \hat{H}\Psi(\vec{r},t)
$$

#### Maxwell's Equations

$$
\nabla \cdot \vec{E} = \frac{\rho}{\epsilon_0}
$$

$$
\nabla \cdot \vec{B} = 0
$$

$$
\nabla \times \vec{E} = -\frac{\partial \vec{B}}{\partial t}
$$

$$
\nabla \times \vec{B} = \mu_0\vec{J} + \mu_0\epsilon_0\frac{\partial \vec{E}}{\partial t}
$$

### Advanced Expressions

#### Taylor Series

$$
e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!} = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + \cdots
$$

#### Fourier Transform

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi ix\xi} \, dx
$$

#### Partial Differential Equations

$$
\frac{\partial u}{\partial t} = \alpha \nabla^2 u
$$

#### Vector Calculus

$$
\oint_C \vec{F} \cdot d\vec{r} = \iint_S (\nabla \times \vec{F}) \cdot d\vec{S}
$$

### Greek Letters

$$
\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta
$$

$$
\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Phi, \Psi, \Omega
$$

### Special Symbols

$$
\forall x \in \mathbb{R}, \exists y \in \mathbb{R}: x + y = 0
$$

$$
A \cap B = \{x \mid x \in A \land x \in B\}
$$

$$
A \cup B = \{x \mid x \in A \lor x \in B\}
$$

$$
\mathbb{N} \subset \mathbb{Z} \subset \mathbb{Q} \subset \mathbb{R} \subset \mathbb{C}
$$