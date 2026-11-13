// qr issues a signed, expiring activity token. Keep QR_SIGNING_SECRET on the
// operator's machine; distribute only the resulting QR token/image.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/PINball1579/Lay-s-Squad-Mission/backend/internal/security"
)

func main() {
	location := flag.String("location", "", "active qr_locations.code")
	ttl := flag.Duration("ttl", 24*time.Hour, "token lifetime, for example 24h")
	flag.Parse()
	if *location == "" || *ttl <= 0 {
		fmt.Fprintln(os.Stderr, "provide -location and a positive -ttl")
		os.Exit(1)
	}
	signer, err := security.NewQRSigner([]byte(os.Getenv("QR_SIGNING_SECRET")), false, nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, "QR_SIGNING_SECRET must contain at least 32 bytes")
		os.Exit(1)
	}
	token, err := signer.Sign(*location, time.Now().Add(*ttl))
	if err != nil {
		fmt.Fprintln(os.Stderr, "could not issue QR token")
		os.Exit(1)
	}
	fmt.Print(token)
}
